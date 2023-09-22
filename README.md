## Rationale

Giving any web application access to sensitive data like an access token is a security risk and should be avoided as much as possible. This library takes advantage of the [Service Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) to store the access token in a secure environment and to attach it to the requests made to the protected resources.

## Installation

```sh
npm install @juxt/pass
yarn add @juxt/pass
```

After installing, you need to run the `init` script to generate the worker and redirect files.

```sh
npx @juxt/pass init
```

This script will place in your project `public` folder the following files:

- `oauth-redirect.html`
- `oauth-service-worker.js`

if your `public` folder is not in the root of your project or if it has a different name, you can specify the path to the folder as a parameter to the `init` script.

```sh
npx @juxt/pass init ./path-to-public-folder
```

## Usage

The library exposes two functions:

- `registerOAuth2Worker` registers a worker that attaches the bearer tokens to the user's provided protected resources. This function should be called once, so if used in an SPA, it should be called in the main entry point of the application.

- `authorize` starts the oauth2 flow and, if successful, grants an access token to the client.
  it takes a single object as a parameter that must have the following shape:

```ts
export type Config = {
  resource_server: string;
  client_id: string;
  redirect_uri: string;
  authorization_endpoint: string;
  token_endpoint: string;
  requested_scopes: string[];
};
```

The following snippet provides a concrete example of how to use this library.

```js
import { registerOAuth2Worker, authorize } from "@juxt/pass";

registerOAuth2Worker();

const resource_server = "https://home.juxt.site";
const authorization_server = "https://auth.home.juxt.site";
const app_server = "https://surveyor.apps.com";

// this callback wraps the `authorize` function and will be invoked when the user clicks for example on a login button
function authorizeCallback() {
  authorize({
    resource_server: resource_server,
    client_id: "surveyor",
    authorization_endpoint: `${authorization_server}/oauth/authorize`,
    token_endpoint: `${authorization_server}/oauth/token`,
    redirect_uri: `${app_server}/oauth-redirect.html`,
    requested_scopes: [],
  });
}
```

The `authorize` function will await for the oauth2 flow to complete and it will return a promise that resolves to a string message. If the flow is successful, the message will be `accessTokenStored` otherwise the promise is rejected with `accessTokenError`.

If the authorize function must be invoked multiple times because the application interacts with multiple protected resources, it is crucial to ensure that these requests are not sent concurrently. Developers should await the completion of the authorize function before making subsequent calls with new parameters.

To clear the access token from the worker, the `clearToken` function can be used.

```js
const msg = await clearToken(resource_server);
```

The resource server (string) must be passed as a parameter to the `clearToken` function. If the token is cleared successfully, the promise will resolve to `accessTokenCleared` otherwise it will be rejected with `clearTokenError`.
