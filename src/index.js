// src/index.js
import { handleRequest } from './routes';

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};
