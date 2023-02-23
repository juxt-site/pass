// to immediately install the service worker
addEventListener("install", (event) => {
  // install on all site tabs without waiting for them to be opened
  skipWaiting();
});

// to immediately activate the service worker
addEventListener("activate", (event) => {
  // activate on all tabs without waiting for them to be opened
  event.waitUntil(clients.claim());
});

const OAUTH2_TOKEN_ENDPOINT =
  new URLSearchParams(location.search).get("token_endpoint") || "";
const OAUTH2_PROTECTED_RESOURCE_URL = new URLPattern(
  Object.fromEntries(
    [...new URLSearchParams(location.search).entries()]
      .filter(([key]) => key.startsWith("protected_"))
      .map(([key, value]) => [key.replace("protected_", ""), value])
  )
);

let oauth2 = {
  access_token: "",
  token_type: "",
  expires_in: 0,
};

const isOauth2TokenURL = (url) => OAUTH2_TOKEN_ENDPOINT === url;
const isOauth2ProtectedResourceURL = (url) =>
  OAUTH2_PROTECTED_RESOURCE_URL.test(url);

// to intercept the request and add the access token to the Authorization header when hitting the protected resource URL.
const modifyRequest = (request) => {
  console.log("is url protected?", isOauth2ProtectedResourceURL(request.url));
  console.log("token_type", oauth2);
  if (
    isOauth2ProtectedResourceURL(request.url) &&
    oauth2.token_type &&
    oauth2.access_token
  ) {
    const headers = new Headers(request.headers);
    if (!headers.has("Authorization")) {
      headers.set(
        "Authorization",
        `${oauth2.token_type} ${oauth2.access_token}`
      );
    }
    return new Request(request, { headers });
  }

  return request;
};

// to intercept the response containing the access token. For all other responses, the original response is returned.
const modifyResponse = async (response) => {
  if (isOauth2TokenURL(response.url) && response.status === 200) {
    const { access_token, token_type, expires_in, ...payload } =
      await response.json();

    oauth2.access_token = access_token;
    oauth2.token_type = token_type;
    oauth2.expires_in = expires_in;

    console.log("Set oauth2 object:", oauth2);

    return new Response(JSON.stringify(payload, null, 2), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  return response;
};

const fetchWithCredentials = (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  return fetch(modifyRequest(request)).then(modifyResponse);
};

addEventListener("fetch", (event) => {
  event.respondWith(fetchWithCredentials(event.request));
});
