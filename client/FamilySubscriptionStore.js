import LoggerFactory from '@/services/utils/LoggerFactory';
const logger = LoggerFactory.getLogger('SubscriptionStore.js');

import FamilySubscriptionService from '@/services/FamilySubscriptionService';
import Utils from '@/services/utils/Utils';
import PopupNamesEnum from '@/enums/PopupNamesEnum';
import { TypesEnum, GroupTypesEnum } from '@shared/enums/SubscriptionTypesEnum';
import { localize as $t } from '@/i18n';

const initState = () => {
  return {
    invitationsList: [],
    groupClosedMessage: null
  };
};

const storeGetters = {
  userHasActiveSubscription(state, getters, rootState, rootGetters) {
    const subscription = rootGetters['PaymentsStore/subscription'];
    return subscription?.active;
  },
  userConsistsInAnotherFamilyGroup: (
    state,
    getters,
    rootState,
    rootGetters
  ) => {
    const subscription = rootGetters['PaymentsStore/subscription'];
    const userId = rootGetters['UserStore/getUserId'];

    return (
      subscription.active &&
      subscription.type === TypesEnum.MONTHLY &&
      subscription.groupType === GroupTypesEnum.FAMILY &&
      subscription.userId !== userId
    );
  },
  userHasCancelledSubscription(state, getters, rootState, rootGetters) {
    const subscription = rootGetters['PaymentsStore/subscription'];
    return (
      subscription.active &&
      subscription.canceledAt < Date.now() &&
      subscription.cancelAt > Date.now()
    );
  },
  getInvitationsList(state) {
    return state.invitationsList;
  },
  isUserFamilyOwner(state, getters, rootState, rootGetters) {
    return rootGetters['UserStore/isUserFamilyGroupOwner'];
  },
  isUserFamilyMember(state, getters, rootState, rootGetters) {
    const res = rootGetters['UserStore/isUserFamilyGroupMember'];
    return res;
  },
  getGroupClosedMessage(state) {
    return state.groupClosedMessage;
  }
};

const actions = {
  async loadInvitations({ commit }) {
    try {
      const invitations = await FamilySubscriptionService.getGroupInvitationsForCurrentUser();
      commit('setInvitationsList', invitations);
    } catch (error) {
      logger.error(error);
    }
  },
  async dropInvitation(
    { commit, dispatch, getters, rootGetters },
    { id, accept, decline }
  ) {
    try {
      if (accept) {
        if (
          !getters.userHasActiveSubscription ||
          getters.userConsistsInAnotherFamilyGroup
        ) {
          await FamilySubscriptionService.acceptInvitation(id);
          await dispatch('UserStore/getUserProfile', null, { root: true });
          commit('dropAllInvitations');
          dispatch(
            'ManagePopupStore/openPopup',
            {
              name: PopupNamesEnum.FAMILY_MEMBER_CONGRADULATION_POPUP
            },
            { root: true }
          );
        } else if (getters.userHasCancelledSubscription) {
          const subscription = rootGetters['PaymentsStore/subscription'];
          dispatch(
            'ManagePopupStore/openSuccessToaster',
            {
              text: $t('Subscription.invitation.joinGroupSince.text', {
                date: Utils.dateFormat(subscription.cancelAt)
              }),
              toasterIcon: 'ico-reports'
            },
            { root: true }
          );
        } else if (getters.userHasActiveSubscription) {
          dispatch(
            'ManagePopupStore/openSuccessToaster',
            {
              text: $t('Subscription.invitation.cancelCurrent.text'),
              clickLabel: $t('Subscription.invitation.cancelCurrent.label'),
              clickHandler: () => {
                dispatch('PaymentsStore/redirectToPortal', null, {
                  root: true
                });
              },
              toasterIcon: 'ico-reports'
            },
            { root: true }
          );
        }
      }
      if (decline) {
        await FamilySubscriptionService.declineInvitation(id);
        commit('dropInvitation', id);
      }
    } catch (error) {
      logger.error(error);
    }
  },
  async loadGroupClosedMessage({ commit }) {
    let closedMessage = await FamilySubscriptionService.getGroupClosedMessage();
    if (!closedMessage) {
      return;
    }
    commit('setGroupClosedMessage', closedMessage);
  },
  async deleteGroupClosedMessage({ commit, rootGetters }) {
    const userId = rootGetters['UserStore/getUserId'];
    await FamilySubscriptionService.closeGroupClosedMessage(userId);
    commit('setGroupClosedMessage', null);
  }
};

const mutations = {
  setInvitationsList(state, invitations) {
    state.invitationsList = invitations;
  },
  dropInvitation(state, id) {
    const index = state.invitationsList.findIndex(item => item.id === id);
    state.invitationsList.splice(index, 1);
  },
  dropAllInvitations(state) {
    state.invitationsList = [];
  },
  setGroupClosedMessage(state, message) {
    state.groupClosedMessage = message;
  }
};

export default {
  state: initState,
  getters: storeGetters,
  actions,
  mutations
};

