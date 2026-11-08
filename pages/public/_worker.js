// Keep the public origin, cookies and request body intact for the app's auth checks.
// The service binding reaches the existing clinic database without a public Worker URL.
export default {
  fetch(request, env) {
    return env.APP.fetch(request);
  },
};
