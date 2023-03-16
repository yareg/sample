class FamilyMember {
  constructor(params) {
    this._id = params._id;
    this.email = params.email;
    this.name = params.name;
    this.isSubscribed = params.isSubscribed;
    this.isDeclined = params.isDeclined;
    this.isPending = params.isPending;
    this.isWaiting = params.isWaiting;
  }
}
class GroupInvitation {
  constructor(params) {
    this.id = params._id;
    this.groupOwnerName = params.groupOwnerName;
    this.groupOwnerEmail = params.groupOwnerEmail;
  }
}

function createFamilyMember(params) {
  return new FamilyMember(params);
}
function createGroupInvitation(params) {
  return new GroupInvitation(params);
}

export default {
  createFamilyMember,
  createGroupInvitation
};

