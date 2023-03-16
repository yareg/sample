<template>
  <div class="subscription-tab">
    <div>
      <div class="section-title mt-3">{{ $t('Settings.sub.head') }}</div>
      <div class="section-description mt-1">
        {{ $t('Settings.sub.subhead') }}
      </div>
    </div>
    <div
      v-for="invitation in groupInvitations"
      :key="invitation.id"
      class="my-6"
    >
      <BannerInfo
        :banner-info="invitation"
        :primary-handler="invitation.primaryHandler"
        :primary-label="invitation.primaryLabel"
        :secondary-handler="invitation.secondaryHandler"
        :secondary-label="invitation.secondaryLabel"
      />
    </div>
    <div v-if="groupClosedMessage">
      <BannerInfo
        :banner-info="groupClosedMessage"
        :primary-handler="groupClosedMessage.primaryHandler"
        :primary-label="groupClosedMessage.primaryLabel"
      />
    </div>

    <v-tabs class="my-6" slider-size="4">
      <v-tab exact :to="{ name: SETTINGS_PLANS }" nuxt>{{
        $t('Settings.sub.tab.plans')
      }}</v-tab>
      <v-tab
        exact
        :to="{ name: SETTINGS_HISTORY }"
        nuxt
        :disabled="isUserFamilyGroupMember"
        >{{ $t('Settings.sub.tab.history') }}</v-tab
      >
      <v-tab
        exact
        :to="{ name: SETTINGS_CARDS }"
        nuxt
        :disabled="isUserFamilyGroupMember"
        >{{ $t('Settings.sub.tab.cards') }}</v-tab
      >
    </v-tabs>
    <slot />
  </div>
</template>

<script>
import { localize as $t } from '@/i18n';
import AppStateEnum from '@/enums/AppStateEnum';
import { mapGetters, mapActions } from 'vuex';
import BannerInfo from '@/components/base/BannerInfo/BannerInfo';
import LoggerFactory from '@/services/utils/LoggerFactory';
const logger = LoggerFactory.getLogger('SubscriptionLayout.vue');

class BannerBase {
  constructor() {
    this.title = '';
    this.description = '';
    this.groupOwnerName = '';
    this.displayControls = true;
    this.customClass = 'settings-block -orange';
    this.primaryLabel = '';
    this.secondaryLabel = '';
    this.primaryHandler = null;
    this.secondaryHandler = null;
  }
}
class BannerInfoSubmission extends BannerBase {
  constructor(params, primaryHandler, secondaryHandler) {
    super();
    this.title = $t('Subscription.family.invitation');
    this.description = params.groupOwnerEmail;
    this.groupOwnerName = params.groupOwnerName;
    this.primaryLabel = $t('Subscription.family.invitation.accept.label');
    this.secondaryLabel = $t('Subscription.family.invitation.decline.label');
    this.primaryHandler = primaryHandler;
    this.secondaryHandler = secondaryHandler;
  }
}

class BannerGroupClosed extends BannerBase {
  constructor(params, primaryHandler) {
    super();
    this.title = $t('Subscription.family.groupClosedMessage');
    this.description = params.groupOwnerEmail;
    this.groupOwnerName = params.groupOwnerName;
    this.primaryLabel = $t('Close');
    this.primaryHandler = primaryHandler;
  }
}

export default {
  name: 'SubscriptionLayout',
  components: {
    BannerInfo
  },
  data() {
    return {
      SETTINGS_PLANS: AppStateEnum.SETTINGS_PLANS,
      SETTINGS_HISTORY: AppStateEnum.SETTINGS_HISTORY,
      SETTINGS_CARDS: AppStateEnum.SETTINGS_CARDS
    };
  },
  computed: {
    ...mapGetters('UserStore', ['isUserFamilyGroupMember']),
    ...mapGetters('FamilySubscriptionStore', [
      'getInvitationsList',
      'getGroupClosedMessage'
    ]),
    groupInvitations() {
      let invitations = this.getInvitationsList;
      invitations = invitations.map(
        invitation =>
          new BannerInfoSubmission(
            invitation,
            () =>
              this.dropInvitation({
                id: invitation.id,
                accept: true,
                decline: false
              }),
            () =>
              this.dropInvitation({
                id: invitation.id,
                accept: false,
                decline: true
              })
          )
      );
      return invitations;
    },
    groupClosedMessage() {
      let message = this.getGroupClosedMessage;
      if (!message) {
        return null;
      }

      message = new BannerGroupClosed(message, this.deleteGroupClosedMessage);
      return message;
    }
  },
  async mounted() {
    try {
      await Promise.all([
        this.loadInvitations(),
        this.loadGroupClosedMessage()
      ]);
    } catch (error) {
      logger.error(error.message);
    }
  },
  methods: {
    ...mapActions('FamilySubscriptionStore', [
      'loadGroupClosedMessage',
      'loadInvitations',
      'dropInvitation',
      'deleteGroupClosedMessage'
    ])
  }
};
</script>

<style src="./SubscriptionLayout.less" lang="less"></style>

