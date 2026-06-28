import { runCodec } from './tool-codec.mjs';

const query = "check system health and find unused plugins";
const result = runCodec(query);
console.log(JSON.stringify(result, null, 2));
