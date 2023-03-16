<template>
  <div v-if="displayGroupMembersList" class="family-members-block pa-6">
    <div class="family-members-header-wrapper mb-4">
      <div class="family-members-header">
        {{ $t('Settings.sub.plans.family') }}
      </div>
      <span>({{ familyMembers.length }}/{{ familyMembersMaxAmount }})</span>
    </div>
    <div class="part-management-block">
      <div class="input-field">
        <BaseTextField
          v-model.trim="$v.inviteEmail.$model"
          class="browser-default"
          :error-messages="inviteValidation.email.errorMessage"
          :placeholder="$t('user@email.com')"
          :maxlength="emailMaxLength"
          :disabled="!isOnline"
          append-icon="$icoPlus"
          @click:append="invite"
          @keyup.enter="invite"
          @input="onInput"
        />
      </div>
    </div>
    <div class="list-of-members">
      <div v-if="subscription.userId === currentUser.id" class="list-item">
        <div class="item-text">
          <div class="item-name-wrapper">
            <div class="item-name">{{ currentUser.name }}</div>
            <div class="item-type">
              {{ $t('Subscription.groupOwner.label') }}
            </div>
          </div>
          <div class="item-email">{{ currentUser.email }}</div>
        </div>
      </div>
      <div
        v-for="member in familyMembers"
        :key="member.email"
        class="list-item mt-2"
      >
        <div class="item-text">
          <div v-if="!member.isPending" class="item-name">
            {{ member.name }}
          </div>
          <div class="item-email">{{ member.email }}</div>
          <div
            v-if="member.isPending || member.isWaiting"
            class="item-status status-waiting"
          >
            {{ $t('Settings.sub.plans.family.member.waiting') }}
          </div>
          <div v-if="member.isDeclined" class="item-status status-declined">
            {{ $t('Settings.sub.plans.family.member.declined') }}
          </div>
        </div>
        <div class="controls-block">
          <BaseButton
            v-if="!member.isSubscribed"
            color="black"
            icon
            :disabled="!isOnline"
            @click="reinvite(currentUser.id, member.email)"
            ><BaseSpriteIcon icon-name="ico-repeat" />
          </BaseButton>
          <BaseButton
            color="error"
            icon
            :disabled="!isOnline"
            @click="deleteMember(member.email, member.isSubscribed)"
          >
            <BaseSpriteIcon icon-name="ico-delete" />
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import { email as validateEmail } from 'vuelidate/lib/validators';

import FamilySubscriptionFactory from '@/classes/factories/FamilySubscription';

import { emailMaxLength } from '@/services/ValidationService';
import FamilySubscriptionService from '@/services/FamilySubscriptionService';

import SubscriptionEventEnum from '@/enums/SubscriptionEventEnum';
import ValidationErrorMessages from '@/enums/ValidationErrorMessagesEnum';

import validationMixin from '@/components/mixins/validationMixin';
import BaseButton from '@/components/base/BaseButton/BaseButton.vue';
import BaseTextField from '@/components/base/BaseTextField/BaseTextField.vue';
import BaseSpriteIcon from '@/components/base/BaseSpriteIcon/BaseSpriteIcon.vue';

import LoggerFactory from '@/services/utils/LoggerFactory';
const logger = LoggerFactory.getLogger('FamilyMembers.vue');

export default {
  name: 'FamilyMembers',
  components: {
    BaseButton,
    BaseTextField,
    BaseSpriteIcon
  },
  mixins: [validationMixin],
  data() {
    const MEMBERS_MAX_AMOUNT = 5;

    return {
      loaded: false,
      familyMembers: [],
      inviteEmail: '',
      inviteValidation: {
        email: {
          isValid: true,
          errorMessage: ''
        }
      },
      emailMaxLength,
      familyMembersMaxAmount: MEMBERS_MAX_AMOUNT
    };
  },
  validations: {
    inviteEmail: {
      emailMaxLength,
      email: validateEmail
    }
  },
  computed: {
    ...mapGetters({
      currentUser: 'UserStore/getUser',
      isOnline: 'ContextStore/isOnline',
      subscription: 'UserStore/getSubscription',
      isUserFamilyGroupOwner: 'UserStore/isUserFamilyGroupOwner',
      isFamilySubscriptionActive: 'UserStore/isFamilySubscriptionActive'
    }),
    displayGroupMembersList() {
      return this.isFamilySubscriptionActive && this.isUserFamilyGroupOwner;
    }
  },
  watch: {
    async isUserFamilyGroupOwner(val) {
      if (!val) {
        return;
      }
      await this.getMembers();
    }
  },
  async mounted() {
    if (this.isUserFamilyGroupOwner) {
      await this.getMembers();
    }
  },
  methods: {
    async getMembers() {
      if (this.loaded) {
        return;
      }
      try {
        this.familyMembers = await FamilySubscriptionService.getExistingFamilyMembers();
      } catch (err) {
        this.familyMembers = [];
        logger.error(err);
      }
      this.loaded = true;
    },
    onInput() {
      this.$v.inviteEmail.$touch();
      const VALIDATION_START_LENGTH = 10;
      if (
        this.inviteEmail.length >= VALIDATION_START_LENGTH &&
        this.$v.inviteEmail.$invalid
      ) {
        this.inviteValidation.email.isValid = false;
        this.inviteValidation.email.errorMessage = this.$t(
          ValidationErrorMessages.EMAIL_IS_INVALID
        );
      } else {
        this.inviteValidation.email.isValid = true;
        this.inviteValidation.email.errorMessage = '';
      }
    },
    async invite() {
      this.$v.inviteEmail.$touch();
      if (this.$v.inviteEmail.$invalid) {
        this.inviteValidation.email.errorMessage = this.$t(
          ValidationErrorMessages.EMAIL_IS_INVALID
        );
        return;
      }

      if (!this.$_isPermittedToAddMember()) {
        this.inviteValidation.email.errorMessage = this.$t(
          'Subscription.participantsNumberExceeded.text'
        );
        return;
      }

      if (
        this.$_getMemberByEmail(this.inviteEmail) ||
        this.currentUser.email === this.inviteEmail
      ) {
        this.inviteValidation.email.errorMessage = this.$t(
          'Subscription.memberExists.text'
        );
        return;
      }
      if (!this.validateEmailFormat(this.inviteEmail)) {
        this.inviteValidation.email.errorMessage = this.$t(
          'Subscription.wrongEmail.text'
        );
        return;
      }

      await this.$_addToList(this.inviteEmail);
      this.inviteEmail = '';
      this.inviteValidation.email.errorMessage = '';
    },
    $_isPermittedToAddMember() {
      return this.familyMembers.length < this.familyMembersMaxAmount;
    },
    $_getMemberByEmail(email) {
      const member = this.familyMembers.find(
        familyMember => familyMember.email === email
      );
      return member;
    },
    async $_addToList(email) {
      let userData;
      try {
        ({
          data: userData
        } = await FamilySubscriptionService.getFamilyMemberData(email));
      } catch (err) {
        logger.error(err);
      }
      const member = FamilySubscriptionFactory.createFamilyMember({
        email,
        name: userData?.name || '',
        isSubscribed: false,
        isDeclined: false,
        isPending: !userData,
        isWaiting: true
      });
      const inviteResult = await this.$_invite(email);

      if (!inviteResult) {
        return;
      }

      this.familyMembers.push(member);
      if (!this.currentUser.email) {
        return;
      }

      const userId = inviteResult.userId;
      if (userId) {
        await this.$store.dispatch('SubscriptionStore/updateSubscribe', {
          type: SubscriptionEventEnum.ADD_STUDENT_EMAIL,
          data: { email: this.currentUser.email, userId }
        });
        return;
      }
    },
    async $_invite(email) {
      try {
        const {
          hasSubscription,
          userId
        } = await FamilySubscriptionService.addFamilyMember(email);
        if (hasSubscription) {
          this.inviteValidation.email.errorMessage = this.$t(
            'Subscription.memberHasSubscription.text'
          );
          return;
        }
        return { userId };
      } catch (err) {
        logger.error(err);
        return;
      }
    },
    async reinvite(ownerId, memberEmail) {
      const currentMembersList = this.familyMembers.map(member => ({
        ...member
      }));
      const memberIndex = currentMembersList.findIndex(
        member => member.email === memberEmail
      );
      const currentMember = currentMembersList[memberIndex];
      let updatedMember = {
        ...currentMember,
        isSubscribed: false,
        isDeclined: false,
        isPending: currentMember.isPending,
        isWaiting: !currentMember.isPending
      };
      updatedMember = FamilySubscriptionFactory.createFamilyMember(
        updatedMember
      );

      try {
        await FamilySubscriptionService.renewInvitation(ownerId, memberEmail);
        currentMembersList[memberIndex] = updatedMember;
        this.familyMembers = currentMembersList;
      } catch (error) {
        logger.error(error);
      }
    },
    async deleteMember(email, isSubscribed) {
      let response;
      try {
        ({
          data: response
        } = await FamilySubscriptionService.deleteFamilyMember(
          email,
          isSubscribed
        ));
      } catch (err) {
        logger.error(err);
      }

      if (!response.success) {
        return;
      }

      const memberIndex = this.familyMembers.findIndex(
        member => member.email === email
      );
      if (memberIndex !== -1) {
        this.familyMembers.splice(memberIndex, 1);
      }
    }
  }
};
</script>

<style lang="less" src="./FamilyMembers.less"></style>

