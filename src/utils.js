// src/utils.js
export function generateUUID() {
  return crypto.randomUUID();
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}