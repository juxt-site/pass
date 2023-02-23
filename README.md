# Usage

Put the `oauth2.js` and `service-worker.js` in your public folder.

From your HTML file you can use the utility functions as follows:

```html
<body>
  <script type="module">
    import { useOAuth2 } from "./oauth2.js";

    const { sendAuthTokenRequest, isError } = useOAuth2({
      client_id: "example-client-id",
      token_endpoint: "https://service-worker/oauth/token",
      authorization_endpoint: "https://service-worker/oauth/authorize",
      redirect_uri: "https://service-worker/index.html",
      requested_scopes: "",
      protected_hostname: "service-worker",
      protected_pathname: "/api/*",
    });

    if (isError) {
      alert("ERROR");
    } else {
      sendAuthTokenRequest(
        (data) => console.log("authenticated"),
        (error) => console.log("not authenticated")
      );
    }
  </script>
</body>
```

## Flow

`useOAuth2` immediately invokes the `sendAuthCodeRequest` function, so the user will be redirected to the `authorization_endpoint` where they will be prompted to login (or not if they have a valid session cookie). The request accepts the following parameters:

```js
{
  client_id,
    redirect_uri,
    response_type,
    scope,
    state,
    code_challenge,
    code_challenge_method;
}
```

After a successful login, the user will be redirected to the `redirect_uri`. At this stage, if there are no errors the `sendAuthTokenRequest` function will be called (by the user). This function will send a request to the `token_endpoint` with the following parameters:

```js
{
  grant_type, code, client_id, code_verifier;
}
```

If the request is successful, the `onSuccess` callback will be called.

The service worker will intercept all requests to the `protected_hostname` and `protected_pathname` and will add the `Authorization` header to the request.

Additionally, when calling the `token_endpoint` the service worker will intercept the request, will grab the `access_token`, `token_type`, and `expires_in` values and will store them in memory. The service worker will also remove those values from the response body, so they become practically inaccessible to the client.
