// Generate a secure random string using the browser crypto functions
function generateRandomString() {
  const array = new Uint32Array(28);
  window.crypto.getRandomValues(array);
  return Array.from(array, (dec) => ("0" + dec.toString(16)).substr(-2)).join(
    ""
  );
}

// Calculate the SHA256 hash of the input text.
// Returns a promise that resolves to an ArrayBuffer
function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

// Base64-urlencodes the input string
function base64urlencode(str) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Return the base64-urlencoded sha256 hash for the PKCE
// challenge
async function pkceChallengeFromVerifier(v) {
  const hashed = await sha256(v);
  return base64urlencode(hashed);
}

async function sendAuthCodeRequestFn({
  client_id,
  redirect_uri,
  authorization_endpoint,
  requested_scopes,
}) {
  // Create and store a random "state" value
  const initState = generateRandomString();

  localStorage.setItem("pkce_state", initState);
  console.log("state:", initState);

  // Create and store a new PKCE code_verifier (the plaintext random secret)
  const code_verifier = generateRandomString();
  localStorage.setItem("pkce_code_verifier", code_verifier);
  console.log("code_verifier (not sent)", code_verifier);

  // Hash and base64-urlencode the secret to use as the challenge
  const code_challenge = await pkceChallengeFromVerifier(code_verifier);
  console.log("code_challenge:", code_challenge);

  // Build the authorization URL
  const queryParams = new URLSearchParams({
    response_type: "code",
    client_id,
    state: initState,
    scope: requested_scopes,
    redirect_uri,
    code_challenge,
    code_challenge_method: "S256",
  });

  const url = `${authorization_endpoint}?${queryParams.toString()}`;

  window.location = url;
}

function sendAuthTokenRequestFn(
  { token_endpoint, client_id, code },
  successFn,
  errorFn
) {
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id,
      code_verifier: localStorage.getItem("pkce_code_verifier"),
    }),
    credentials: "include",
  };
  code &&
    fetch(token_endpoint, options)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        return response.json();
      })
      .then((data) => {
        successFn(data);
        window.history.replaceState({}, null, "/");
      })
      .catch((error) => {
        errorFn(error);
      });
}

export function useOAuth2({
  client_id,
  token_endpoint,
  authorization_endpoint,
  redirect_uri,
  requested_scopes,
  protected_hostname,
  protected_pathname,
}) {
  navigator.serviceWorker.register(
    `./service-worker.js?${new URLSearchParams({
      client_id,
      token_endpoint,
      protected_hostname,
      protected_pathname,
    })}`
  );

  const sendAuthCodeRequest = () =>
    sendAuthCodeRequestFn({
      client_id,
      redirect_uri,
      authorization_endpoint,
      requested_scopes,
    });

  const params = new URLSearchParams(location.search.substring(1));
  const { error, code, state } = Object.fromEntries(params.entries());

  const isInvalid =
    error || (code && state !== localStorage.getItem("pkce_state"));
  const isInvalidMessage = error
    ? `Error: ${error}`
    : "Response state does not match local state";
  const isError = isInvalid && isInvalidMessage;

  const sendAuthTokenRequest = (successFn, errorFn) =>
    sendAuthTokenRequestFn(
      { token_endpoint, client_id, code },
      successFn,
      errorFn
    );

  return { sendAuthCodeRequest, sendAuthTokenRequest, isError };
}
