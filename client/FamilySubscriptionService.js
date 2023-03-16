import RestService from '@/services/RestService';
import SubscribeFactory from '@/classes/factories/SubscribeFactory';
import FamilySubscriptionFactory from '@/classes/factories/FamilySubscription';

async function getExistingFamilyMembers() {
  const resp = await RestService.restRequest(
    'get',
    'Users',
    'existingfamilymembers'
  );
  const members = resp.data.map(member =>
    FamilySubscriptionFactory.createFamilyMember(member)
  );

  return members;
}

async function getGroupInvitationsForCurrentUser() {
  const response = await RestService.restRequest(
    'get',
    'Users',
    'familygroupinvitations'
  );

  const invitations = response.data.map(invitation =>
    FamilySubscriptionFactory.createGroupInvitation(invitation)
  );

  return invitations;
}

function acceptInvitation(invitationId) {
  const updateRequest = {
    add: SubscribeFactory.createAddEmailRequest([''], ''),
    delete: SubscribeFactory.createDeleteEmailRequest([''], '')
  };
  return RestService.restRequest('post', 'Users', 'acceptinvitation', {
    invitationId,
    updateRequest
  });
}

function declineInvitation(invitationId) {
  return RestService.restRequest('post', 'Users', 'declineinvitation', {
    invitationId
  });
}

async function renewInvitation(ownerId, memberEmail) {
  let { data: invitation } = await RestService.restRequest(
    'put',
    'Users',
    'renewinvitation',
    {
      ownerId,
      memberEmail
    }
  );
  invitation = FamilySubscriptionFactory.createGroupInvitation(invitation);

  return invitation;
}

async function addFamilyMember(email) {
  const resp = await RestService.restRequest(
    'post',
    'Users',
    'addfamilymember',
    {
      email
    }
  );
  return resp.data;
}

async function getFamilyMemberData(email) {
  const resp = await RestService.restRequest('get', 'Users', 'email', {
    email
  });

  return resp;
}

async function deleteFamilyMember(email, isSubscribed) {
  const updateRequest = isSubscribed
    ? SubscribeFactory.createDeleteEmailRequest([''], '')
    : null;
  const response = await RestService.restRequest(
    'delete',
    'Users',
    'familymember',
    { email, updateRequest }
  );

  return response;
}

async function getGroupClosedMessage() {
  const response = await RestService.restRequest(
    'get',
    'Users',
    'groupclosedmessage'
  );

  return response.data.message;
}

async function closeGroupClosedMessage() {
  const response = await RestService.restRequest(
    'delete',
    'Users',
    'groupclosedmessage'
  );

  return response;
}

export default {
  getExistingFamilyMembers,
  getGroupInvitationsForCurrentUser,
  acceptInvitation,
  declineInvitation,
  renewInvitation,
  addFamilyMember,
  getFamilyMemberData,
  deleteFamilyMember,
  getGroupClosedMessage,
  closeGroupClosedMessage
};

