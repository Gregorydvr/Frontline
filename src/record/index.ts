// Every record function, and nothing else. The cross-firm tests walk this
// list: a function added here without its own cross-firm test fails them.
//
// Every function takes the firm, apart from the three that find or make a
// firm, createFirm(), exampleFirms() and findFirmByNumber(); findDue(), with
// which the clock finds what is due for every firm at once; findLink(),
// which finds the firm from the token in a link a customer opens; and the
// four that find the firm when an owner logs in: findOwnersByMobile(),
// findLoginLink(), logInWithLink() and findSession(); and, for the control
// room, findOrAddStaff(), since staff belong to no firm, and listFirms(), the
// list staff choose a firm from; and, for keeping and deleting,
// addMissingSweeps(), with which the clock gives every firm its daily sweep,
// ledgerSince(), the deletes to do again after a restore, across firms; and
// logStaffAcrossFirms(), for what staff view across every firm.

export {
  createFirm,
  exampleFirms,
  findFirmByNumber,
  getFirm,
  setDiaryRules,
  setFirmNumber,
  setService,
  setStopButton,
  setUrgentList,
} from './firms';
export { createOwner, getOwner, listOwners, setOwnerMobile } from './owners';
export {
  confirmCustomerDetails,
  createCustomer,
  findCustomersByLandline,
  findCustomersByMobile,
  getCustomer,
  listCustomers,
} from './customers';
export { createJob, getJob, listJobs, listJobsForCustomer } from './jobs';
export { cancelVisit, createVisit, getVisit, listVisitsForJob, listVisitsFrom, moveVisit } from './visits';
export { findHoldForCall, holdTime, listTakenTimes, releaseHold } from './holds';
export { findLink, linkForDue } from './links';
export { findCallByProviderId, getCall, listCallsBetween, markCallBooked, recordCall } from './calls';
export { addHistory, historyBetween, historyForCustomer, historyForJob } from './history';
export { firmWording, setWording } from './wording';
export { isNumberOptedOut, listOptOuts, optIn, optOut, optOutNumber } from './opt-outs';
export { addDue, cancelDue, claimDue, findDue, finishDue, getDue, listDueForCall, listDueForVisit, releaseDue } from './due';
export {
  claimMessage,
  findMessageForDue,
  getMessage,
  hasTextedCustomer,
  listMessagesBetween,
  listMessagesForJob,
  markMessageFailed,
  markMessageSent,
  recordDelivery,
} from './messages';
export { listTextsInBetween, recordTextIn } from './texts-in';
export {
  countLoginLinks,
  createLoginLink,
  endSession,
  findLoginLink,
  findOwnersByMobile,
  findSession,
  logInWithLink,
  loginLinkForDue,
} from './logins';
export { recordOwnerMessage } from './owner-messages';
export { findOrAddStaff, logStaff, logStaffAcrossFirms } from './staff';
export {
  customerFile,
  customerFileCounts,
  deleteCustomer,
  redoCustomerDelete,
  findCustomers,
  listFailedTexts,
  listFirms,
  listOwnerMessages,
  needsALook,
} from './control';
export { deleteExampleFirm, setExampleClock } from './example';
export {
  addMissingSweeps,
  deleteRecording,
  emptyBin,
  getCallRecording,
  giveUpRecording,
  markMissingRecordings,
  moveRecording,
  readCallRecording,
  sweepFirm,
} from './keeping';
export {
  askFirmExport,
  cancelLeaving,
  deleteFirm,
  deleteLeftFirm,
  downloadFirmExport,
  exportToMake,
  firmTablePage,
  listFirmExports,
  markFirmExportReady,
  markLeaving,
  openFirmExportFile,
  redoFirmDelete,
  wasFirmDeleted,
} from './firm-file';
export { ledgerSince, listFiles, placeInInbox } from './files';
