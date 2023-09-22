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

// to send a message to all clients
function sendMessage(message) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage(message);
    });
  });
}

// These Maps are indexed by the resource_server of the protected resource URLs.
// There will be one entry in each Map for each protected resource URL,
// which is provided by the user when calling the authenticate({...}) method.
const tokenExpirationStore = new Map();
const refreshTokenStore = new Map();
const tokenStore = new Map();
const configStore = new Map();

function clearToken(resource_server) {
  try {
    tokenExpirationStore.delete(resource_server);
    refreshTokenStore.delete(resource_server);
    tokenStore.delete(resource_server);
    configStore.delete(resource_server);

    sendMessage({ type: "accessTokenCleared" });
  } catch (e) {
    sendMessage({ type: "clearTokenError" });
  }
}

self.addEventListener("message", (event) => {
  const type = event.data.type;

  switch (type) {
    case "storeConfig":
      configStore.set(event.data.config.resource_server, event.data.config);
      break;
    case "clearToken":
      clearToken(event.data.resource_server);
      break;
    default:
      console.log("type:", type, "not handled");
  }
});

function refreshToken(configItem) {
  const refreshToken = refreshTokenStore.get(configItem.resource_server);

  const headers = new Headers();
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);

  return fetch(configItem.token_endpoint, {
    method: "POST",
    headers,
    body,
  });
}

function createHeaders(headers, accessToken) {
  const newHeaders = new Headers(headers);
  // Only add the Authorization header if the user hasn't added a custom one for a given protected resource URL.
  if (!newHeaders.has("Authorization")) {
    newHeaders.set("Authorization", `Bearer ${accessToken}`);
  }
  return newHeaders;
}

function getTimestampInSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function handleTokenResponse(response, configItem) {
  try {
    const status = response.status;

    if (status >= 400 && status < 600) {
      throw new Error("Token request failed");
    }
    const { access_token, refresh_token, expires_in } = await response.json();

    tokenStore.set(configItem.resource_server, access_token);
    refreshTokenStore.set(configItem.resource_server, refresh_token);
    tokenExpirationStore.set(configItem.resource_server, {
      expires_in,
      date: getTimestampInSeconds(),
    });
    sendMessage({ type: "accessTokenStored" });
  } catch (e) {
    sendMessage({ type: "accessTokenError" });
  }
}

// This function intercepts all requests, but only handles those directed to the protected resource URLs.
// Particularly, it adds the Authorization header to the protected resource requests, a Bearer Token,
// and asks for a new token if the current one has expired before sending the request.
async function attachBearerToken(request, _clientId) {
  const { origin } = new URL(request.url);

  const configItem = configStore.get(origin);
  if (!configItem || configItem.token_endpoint === request.url) {
    return request;
  }

  if (tokenStore.get(configItem.resource_server)) {
    const { expires_in, date } = tokenExpirationStore.get(
      configItem.resource_server
    );

    if (getTimestampInSeconds() - date > expires_in) {
      try {
        const response = await refreshToken(configItem);
        await handleTokenResponse(response, configItem);
      } catch (e) {
        console.err(
          "Something went wrong while trying to refetch the access token:",
          e
        );
      }
    }

    const headers = createHeaders(
      request.headers,
      tokenStore.get(configItem.resource_server)
    );

    return new Request(request, { headers });
  } else {
    return request;
  }
}

function isTokenEndpoint(url) {
  for (const [_, value] of configStore) {
    if (value.token_endpoint === url) {
      return value;
    }
  }
}

// This function intercepts all responses, but only handles the ones from the token endpoint.
// It stores the access token, refresh token, and expiration date in the corresponding Maps in memory,
// and returns a new Response to the client without the body to avoid exposing the access token.
async function storeBearerToken(response) {
  const url = response.url;
  const configItem = isTokenEndpoint(url);

  if (!configItem) {
    return response;
  }

  await handleTokenResponse(response, configItem);

  return new Response({
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function fetchWithBearerToken({ request, clientId }) {
  const newRequest =
    request instanceof Request ? request : new Request(request);
  const attachBearerTokenFn = await attachBearerToken(newRequest, clientId);
  return fetch(attachBearerTokenFn).then(storeBearerToken);
}

addEventListener("fetch", (event) => {
  event.respondWith(fetchWithBearerToken(event));
});
