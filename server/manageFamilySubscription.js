const { groupBy } = require('underscore');
const mail = require('../mailings/controllers/sendEmailController.js');
const SubscriptionDao = require('../utils/dao/SubscriptionDao');
const FamilyMemberDao = require('../utils/dao/FamilyMemberDao');
const FamilyInviteDao = require('./dao/familyInviteDao');
const FamilyGroupClosedDao = require('./dao/familyGroupClosedDao');
const subscribeManager = require('./subscribeManager');
const usersDao = require('../utils/dao/usersDao');
const {
  TypesEnum,
  GroupTypesEnum
} = require('../../shared/enums/SubscriptionTypesEnum');
const logger = require('../utils/logger.js').getLogger(__filename);

const FM_REQUEST_STATUS = {
  NEW: 'new',
  APPROVED: 'approved',
  DECLINED: 'declined'
};
class FamilyMember {
  constructor({ id, email, name }, groupMemberEmail) {
    this.groupMemberEmail = groupMemberEmail;
    this.groupOwnerId = id;
    this.groupOwnerEmail = email;
    this.groupOwnerName = name;
    this.subscribed = false;
    this.subscriptionRequestStatus = FM_REQUEST_STATUS.NEW;
    this.processed = new Date().toISOString();
  }
}

class AddFamilyMemberResult {
  constructor(subscriptionId, hasSubscription, userId) {
    this._id = subscriptionId;
    this.hasSubscription = hasSubscription;
    this.userId = userId;
  }
}

async function addFamilyMember(currentUser, groupMemberEmail) {
  let subscription;
  try {
    subscription = await SubscriptionDao.getSubscriptionByEmail(
      groupMemberEmail
    );
  } catch (err) {
    if (
      err?.statusMessages?.length !== 1 ||
      err?.statusMessages[0]?.text !==
        '{"key":"server.auth.userNotFound.error"}'
    ) {
      throw err;
    }
  }
  if (subscription) {
    return new AddFamilyMemberResult(subscription._id, !!subscription, null);
  }

  const { _id: id, email, name } = currentUser;
  const groupOwnerData = { id, email, name };

  const member = new FamilyMember(groupOwnerData, groupMemberEmail);

  const docId = await FamilyMemberDao.insertOne(member);

  const addingResult = await _addMemberSubscription(
    currentUser,
    groupMemberEmail
  );
  const userId = addingResult ? addingResult.userId : null;

  if (userId) {
    await FamilyInviteDao.addInvite(userId);
  }

  return new AddFamilyMemberResult(docId, false, userId);
}

async function _addMemberSubscription(groupOwner, userEmail) {
  const groupOwnerEmailData = {
    name: groupOwner.name,
    email: groupOwner.email
  };
  const { user, isRegistered } = await _notifyUser(
    userEmail,
    groupOwnerEmailData
  );

  if (!isRegistered) {
    return;
  }

  return {
    userId: user._id
  };
}

async function _notifyUser(userEmail, sender) {
  let user;
  try {
    user = await usersDao.findByEmail(userEmail);
  } catch (err) {
    user = null;
  }

  let isRegistered = true;

  if (!user) {
    isRegistered = false;

    user = {
      email: userEmail,
      name: ''
    };
  }

  const recipientProfile = {
    email: user.email,
    name: user.name
  };
  try {
    await _sendEmailInvitation(sender, recipientProfile);
  } catch (error) {
    logger.error(
      `Error sending group invitation email: ${error.message} ${error.stack}`
    );
  }
  return { user, isRegistered };
}

async function _sendEmailInvitation(sender, recipientProfile) {
  const options = {
    language: 'en'
  };

  await mail.sendFamilyMemberInvitation(sender, recipientProfile, options);
}

async function getExistingFamilyMembers(userId) {
  const subscriptionInvitations = await _getCurrentSubscribersEmails(userId);
  let { emails, members } = await _getRegisteredMembers(
    subscriptionInvitations
  );
  members = _addPendingMembers(members, emails);

  return members;
}

async function _getCurrentSubscribersEmails(groupOwnerId) {
  const invitations = await FamilyMemberDao.find({ groupOwnerId }, [
    'groupMemberEmail',
    'subscriptionRequestStatus',
    'subscribed'
  ]);

  return invitations;
}

function _addPendingMembers(members, emails) {
  const membersByEmail = groupBy(members, member => member.email);

  for (const email of emails) {
    if (membersByEmail[email] === undefined) {
      const pendingMember = {
        email,
        name: '',
        isPending: true
      };
      members.push(pendingMember);
    }
  }

  return members;
}

async function _getRegisteredMembers(invitations) {
  const { emails, groupedInvitations } = invitations.reduce(
    (result, item) => {
      result.emails.push(item.groupMemberEmail);
      result.groupedInvitations[item.groupMemberEmail] = item;
      return result;
    },
    { emails: [], groupedInvitations: {} }
  );

  const requiredFields = ['name', 'email'];
  let members = await usersDao.findAllByEmails(emails, requiredFields);
  members = members.map(member => {
    const memberInvitation = groupedInvitations[member.email];
    Object.assign(member, {
      isWaiting:
        memberInvitation.subscriptionRequestStatus === FM_REQUEST_STATUS.NEW,
      isDeclined:
        memberInvitation.subscriptionRequestStatus ===
        FM_REQUEST_STATUS.DECLINED,
      isPending: false,
      isSubscribed: memberInvitation.subscribed
    });

    return member;
  });

  return { emails, members };
}

async function getGroupMemberInvitations(currentUser) {
  const invitations = await FamilyMemberDao.find(
    {
      groupMemberEmail: currentUser.email,
      subscriptionRequestStatus: FM_REQUEST_STATUS.NEW
    },
    ['_id', 'groupOwnerName', 'groupOwnerEmail']
  );

  return invitations;
}

async function acceptInvitation(currentUser, invitationId) {
  const currentUserData = {
    _id: currentUser._id,
    email: currentUser.email
  };
  const currentParticipantsData = await _getCurrentInvitationData(
    currentUserData
  );

  const searchCriteria = {
    invitationId,
    groupMemberEmail: currentUserData.email
  };
  await FamilyMemberDao.withTransaction(
    [FamilyMemberDao, SubscriptionDao],
    async ([FamilyTransactionDao, SubscriptionTransactionDao]) => {
      await Promise.all([
        _removeFromCurrentFamilyGroup(currentUserData, invitationId, {
          FamilyTransactionDao,
          SubscriptionTransactionDao
        }),
        _declineOtherInvitations(
          currentUserData.email,
          invitationId,
          FamilyTransactionDao
        ),
        _updateGroupMemberInvitation(
          searchCriteria,
          FM_REQUEST_STATUS.APPROVED,
          FamilyTransactionDao
        )
      ]);
      const participantsData = await _includeUserIntoSubscription(
        currentUserData,
        invitationId,
        SubscriptionTransactionDao
      );

      const subscriptionData = {
        add: participantsData,
        delete: currentParticipantsData
      };

      return subscriptionData;
    }
  );
}

async function _removeFromCurrentFamilyGroup(
  currentUser,
  invitationId,
  transactionDao
) {
  const userId = currentUser._id;
  const { FamilyTransactionDao, SubscriptionTransactionDao } = transactionDao;

  const familyCriteria = {
    _id: { $ne: invitationId },
    groupMemberEmail: currentUser.email,
    subscribed: true
  };
  const familyData = {
    subscribed: false,
    subscriptionRequestStatus: FM_REQUEST_STATUS.DECLINED,
    processed: new Date()
  };

  return Promise.all([
    FamilyTransactionDao.updateManyByQuery(familyCriteria, familyData, false, {
      upsert: false
    }),
    _removeMemberFromGroup(userId, SubscriptionTransactionDao)
  ]);
}

function _removeMemberFromGroup(userId, SubscriptionTransactionDao) {
  const subscriptionCriteria = {
    active: true,
    type: TypesEnum.MONTHLY,
    groupType: GroupTypesEnum.FAMILY,
    group: userId
  };

  const subscriptionData = {
    $pull: {
      group: {
        $in: [userId]
      }
    }
  };

  return SubscriptionTransactionDao.updateMany(
    subscriptionCriteria,
    subscriptionData
  );
}

async function _declineOtherInvitations(
  groupMemberEmail,
  invitationId,
  FamilyTransactionDao
) {
  const criteria = {
    _id: { $ne: invitationId },
    groupMemberEmail,
    subscriptionRequestStatus: FM_REQUEST_STATUS.NEW
  };
  const data = {
    subscriptionRequestStatus: FM_REQUEST_STATUS.DECLINED,
    processed: new Date()
  };
  await FamilyTransactionDao.updateManyByQuery(criteria, data, false, {
    upsert: false
  });
}

async function _updateGroupMemberInvitation(
  searchCriteria,
  newStatus,
  FamilyTransactionDao
) {
  const FamilyDao = FamilyTransactionDao || FamilyMemberDao;
  await FamilyDao.updateOneByQuery(
    {
      _id: searchCriteria.invitationId,
      groupMemberEmail: searchCriteria.groupMemberEmail
    },
    {
      subscriptionRequestStatus: newStatus,
      subscribed: newStatus === FM_REQUEST_STATUS.APPROVED,
      processed: new Date()
    },
    false,
    { upsert: false }
  );
}

async function _getCurrentInvitationData(currentUser) {
  const criteria = {
    subscribed: true,
    groupMemberEmail: currentUser.email
  };
  const invitation = await FamilyMemberDao.findOne(criteria, [
    'groupOwnerEmail'
  ]);

  if (!invitation) {
    return null;
  }

  const currentData = {
    userId: currentUser._id,
    email: currentUser.email,
    groupOwnerEmail: invitation.groupOwnerEmail
  };

  return currentData;
}

async function _includeUserIntoSubscription(
  currentUser,
  invitationId,
  SubscriptionTransactionDao
) {
  const invitation = await FamilyMemberDao.findOne({ _id: invitationId }, [
    'groupOwnerId',
    'groupMemberEmail',
    'groupOwnerEmail'
  ]);

  if (invitation.groupMemberEmail !== currentUser.email) {
    throw new Error(
      `Attemption to add user #${currentUser._id} into unfamiliar Family group by invitation #${invitationId}`
    );
  }

  const userId = currentUser._id;
  const groupOwnerId = invitation.groupOwnerId;

  const subscription = await SubscriptionDao.findByUserId(groupOwnerId);
  subscription.group = subscription.group || [];

  if (!_isPermittedAddGroupMember(subscription.group, userId, groupOwnerId)) {
    return;
  }
  subscription.group.push(userId);

  await SubscriptionTransactionDao.update(subscription._id, {
    group: subscription.group
  });

  const participantsData = {
    userId,
    email: currentUser.email,
    groupOwnerEmail: invitation.groupOwnerEmail
  };

  return participantsData;
}

function _isPermittedAddGroupMember(group, userId, ownerId) {
  const MEMBERS_MAX_AMOUNT = 5;
  if (group.length >= MEMBERS_MAX_AMOUNT) {
    return false;
  }

  if (group.indexOf(userId) !== -1) {
    return false;
  }

  if (userId === ownerId) {
    return false;
  }

  return true;
}

async function declineInvitation(groupMemberEmail, invitationId) {
  await _updateGroupMemberInvitation(
    { groupMemberEmail, invitationId },
    FM_REQUEST_STATUS.DECLINED
  );
}

async function renewInvitation(groupOwner, groupOwnerId, groupMemberEmail) {
  const response = await _updateGroupOwnerInvitation(
    groupOwner.email,
    { groupOwnerId, groupMemberEmail },
    FM_REQUEST_STATUS.NEW
  );

  let groupMemberId;
  try {
    ({ _id: groupMemberId } = await usersDao.findByEmail(groupMemberEmail));
  } catch (_) {
    groupMemberId = null;
  }

  if (groupMemberId) {
    await FamilyInviteDao.addInvite(groupMemberId);
  }

  const groupOwnerEmailData = {
    name: groupOwner.name,
    email: groupOwner.email
  };

  await _notifyUser(groupMemberEmail, groupOwnerEmailData);

  return response.value;
}

async function _updateGroupOwnerInvitation(groupOwnerEmail, filter, newStatus) {
  const { groupOwnerId, groupMemberEmail } = filter;

  const response = await FamilyMemberDao.updateOneByQuery(
    {
      groupOwnerId,
      groupMemberEmail,
      groupOwnerEmail
    },
    {
      subscriptionRequestStatus: newStatus,
      processed: new Date()
    }
  );

  return response;
}

async function dropFamilyMember(currentUserId, email) {
  const groupMember = await _getMemberProfileIfExists(email);
  if (!groupMember) {
    const hasSubscription = false;
    const options = {
      hasSubscription,
      groupMemberData: null
    };
    await _dropFamilyMemberByGroupOwner(email, currentUserId, options);
    return;
  }

  const participantsData = await _getDataToUnsubscribe(
    currentUserId,
    groupMember._id,
    email
  );

  const memberSubscription = await SubscriptionDao.getSubscriptionById(
    groupMember._id
  );

  if (!memberSubscription || memberSubscription.userId === currentUserId) {
    const groupMemberData = {
      _id: groupMember._id,
      email: groupMember.email,
      name: groupMember.name
    };
    const options = {
      hasSubscription: !!memberSubscription,
      groupMemberData
    };
    await _dropFamilyMemberByGroupOwner(email, currentUserId, options);
    return participantsData;
  }

  await _dropFamilyMemberHimself(email, currentUserId);

  return participantsData;
}

async function _getMemberProfileIfExists(email) {
  try {
    const groupMember = await usersDao.findByEmail(email);
    return groupMember;
  } catch (error) {
    const severityResponseText = error?.statusMessages[0]?.text;
    if (!severityResponseText) {
      throw error;
    }
    const parsedText = JSON.parse(severityResponseText);
    if (parsedText?.key !== 'server.auth.userNotFound.error') {
      throw error;
    }
    return null;
  }
}

async function _dropFamilyMemberByGroupOwner(
  groupMemberEmail,
  groupOwnerId,
  options
) {
  const { hasSubscription, groupMemberData } = options;

  FamilyMemberDao.withTransaction(
    [FamilyMemberDao, SubscriptionDao],
    async ([FamilyTransactionDao, SubscriptionTransactionDao]) => {
      await FamilyTransactionDao.dropByEmailAndOwnerId(
        groupMemberEmail,
        groupOwnerId
      );

      const { name: groupOwnerName } = await usersDao.findById(groupOwnerId);
      let promisesList = [];
      let groupMemberEmailData;
      let groupMemberId;

      if (groupMemberData) {
        ({ _id: groupMemberId, ...groupMemberEmailData } = groupMemberData);

        promisesList = [
          _dropUserIdFromUserSubscriptions(
            groupOwnerId,
            groupMemberId,
            SubscriptionTransactionDao
          ),
          FamilyInviteDao.deleteInvite(groupMemberId)
        ];
      } else {
        groupMemberEmailData = {
          name: groupMemberEmail,
          email: groupMemberEmail
        };
      }

      promisesList.push(
        mail.sendFamilyGroupMembershipCanceledNotification(
          groupOwnerName,
          groupMemberEmailData,
          hasSubscription
        )
      );

      await Promise.all(promisesList);
    }
  );
}

async function _dropFamilyMemberHimself(groupMemberEmail, groupMemberId) {
  const groupMember = await usersDao.findById(groupMemberId);
  if (groupMember.email !== groupMemberEmail) {
    return;
  }

  const familyCriteria = {
    groupMemberEmail: groupMember.email,
    subscribed: true
  };

  FamilyMemberDao.withTransaction(
    [FamilyMemberDao, SubscriptionDao],
    async ([FamilyTransactionDao, SubscriptionTransactionDao]) => {
      await Promise.all([
        FamilyTransactionDao.deleteOne(familyCriteria),
        _removeMemberFromGroup(groupMember._id, SubscriptionTransactionDao)
      ]);
    }
  );
}

async function _getDataToUnsubscribe(userId, groupMemberId, groupMemberEmail) {
  const { userId: groupOwnerId } = await SubscriptionDao.getSubscriptionById(
    userId,
    true
  );
  const groupOwnerData = await usersDao.findById(groupOwnerId);
  if (groupOwnerData) {
    return {
      userId: groupMemberId,
      email: groupMemberEmail,
      groupOwnerEmail: groupOwnerData.email
    };
  }
}

async function _dropUserIdFromUserSubscriptions(
  groupOwnerId,
  userId,
  SubscriptionTransactionDao
) {
  const subscription = await SubscriptionDao.findByUserId(groupOwnerId);

  if (!subscription.group || !subscription.group.length) {
    return;
  }
  const memberIndex = subscription.group.findIndex(id => id === userId);

  if (memberIndex !== -1) {
    subscription.group.splice(memberIndex, 1);
  }

  await SubscriptionTransactionDao.update(subscription._id, {
    group: subscription.group
  });
}

async function closeFamilyGroup(groupOwnerProfile) {
  try {
    const {
      group: subscriptionGroup
    } = await SubscriptionDao.findByUserId(groupOwnerProfile._id, ['group']);

    await _sendGroupMembersCloseGroupNotifications(
      groupOwnerProfile.name,
      subscriptionGroup
    );

    await _deleteGroupOwnerFollowers(
      groupOwnerProfile._id,
      groupOwnerProfile.email,
      groupOwnerProfile.deletedAt
    );

    const groupOwnerData = {
      groupOwnerEmail: groupOwnerProfile.email,
      groupOwnerName: groupOwnerProfile.name
    };
    await _sendGroupClosedMessage(subscriptionGroup, groupOwnerData);
  } catch (error) {
    logger.error(error);
  }
}

async function _sendGroupMembersCloseGroupNotifications(
  groupOwnerName,
  subscriptionGroup
) {
  const groupMembersPromises = subscriptionGroup.map(async userId => {
    const memberProfile = await usersDao.findById(userId);
    return {
      email: memberProfile.email,
      name: memberProfile.name
    };
  });

  const groupMembers = await Promise.all(groupMembersPromises);
  const sendMailPromises = groupMembers.map(groupMemberProfile =>
    mail.sendFamilyGroupClosedNotification(groupOwnerName, groupMemberProfile)
  );

  try {
    await Promise.all(sendMailPromises);
  } catch (error) {
    logger.error(
      `Closing family group: couldn't send to users notification email: ${error.message}`
    );
  }
}
async function _deleteGroupOwnerFollowers(
  groupOwnerId,
  groupOwnerEmail,
  deletedAt
) {
  if (deletedAt) {
    return;
  }

  await subscribeManager.unsubscribeFromTeacher(groupOwnerId, groupOwnerEmail);
}
async function _sendGroupClosedMessage(subscriptionGroup, groupOwnerData) {
  const promiseslist = subscriptionGroup.map(memberId =>
    FamilyGroupClosedDao.saveMessage(memberId, groupOwnerData)
  );
  await Promise.all(promiseslist);
}

async function getGroupClosedMessage(userId) {
  const groupClosedMessage = await FamilyGroupClosedDao.getMessage(userId);
  return groupClosedMessage;
}

async function dropGroupClosedMessage(userId) {
  await FamilyGroupClosedDao.deleteMessage(userId);
  return true;
}

module.exports = {
  addFamilyMember,
  closeFamilyGroup,
  dropGroupClosedMessage,
  getExistingFamilyMembers,
  getGroupClosedMessage,
  getGroupMemberInvitations,
  acceptInvitation,
  declineInvitation,
  renewInvitation,
  dropFamilyMember
};

