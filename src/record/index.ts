// Every record function, and nothing else. The cross-firm tests walk this
// list: a function added here without its own cross-firm test fails them.
//
// Every function takes the firm, apart from the three that find or make a
// firm: createFirm(), exampleFirms() and findFirmByNumber().

export {
  createFirm,
  exampleFirms,
  findFirmByNumber,
  getFirm,
  setFirmNumber,
  setService,
  setStopButton,
  setUrgentList,
} from './firms';
export { createOwner, getOwner, listOwners } from './owners';
export {
  createCustomer,
  findCustomersByLandline,
  findCustomersByMobile,
  getCustomer,
  listCustomers,
} from './customers';
export { createJob, getJob, listJobs, listJobsForCustomer } from './jobs';
export { createVisit, getVisit, listVisitsForJob, listVisitsFrom } from './visits';
export { findCallByProviderId, getCall, listCallsBetween, markCallBooked, recordCall } from './calls';
export { addHistory, historyBetween, historyForCustomer, historyForJob } from './history';
