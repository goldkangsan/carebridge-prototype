import M from '../web/model.js';
import {createApi} from '../worker/api.mjs';
export default { fetch: createApi(M) };
