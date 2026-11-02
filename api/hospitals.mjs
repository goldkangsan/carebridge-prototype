import M from '../web/model.js';
import {createIntegrations} from '../worker/integrations.mjs';
export default {fetch:createIntegrations(M)};
