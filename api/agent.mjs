import M from '../web/model.js';
import {createAgentApi} from '../worker/agents.mjs';
export default {fetch:createAgentApi(M)};
