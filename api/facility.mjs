import M from '../web/model.js';
import {createFacilityApi} from '../worker/agents.mjs';
export default {fetch:createFacilityApi(M)};
