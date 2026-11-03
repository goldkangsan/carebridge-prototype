import M from '../web/model.js';
import {createCasesApi} from '../worker/cases.mjs';
export default {fetch:createCasesApi(M)};
