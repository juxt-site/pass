/* eslint-disable @typescript-eslint/naming-convention */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js')
importScripts('https://cdn.jsdelivr.net/npm/idb@7/build/umd.js')

// Disable the annoying logging
workbox.setConfig({ debug: false })

workbox.loadModule('workbox-strategies')
workbox.loadModule('workbox-routing')
workbox.loadModule('workbox-expiration')

const { registerRoute, Route } = workbox.routing
const { NetworkOnly } = workbox.strategies

/**
 * Get an instance of the database, creating the object stores when needed
 */
async function store() {
  return await self.idb.openDB('pass-storage', 1, {
    upgrade(db) {
      db.createObjectStore('config')
      db.createObjectStore('token_store')
    }
  })
}

/**
 * Get the current time in seconds
 */
function currentTime() {
  return Math.floor(Date.now() / 1000)
}

/**
 * Update a headers object to include the token if required
 * @param {Headers} headers - A headers object.
 * @param {string} accessToken - The token to add if needed.
 */
function createHeaders(headers, accessToken) {
  const newHeaders = new Headers(headers)
  // Only add the Authorization header if the user hasn't added a custom one for
  // a given protected resource URL.
  if (!newHeaders.has('Authorization')) {
    newHeaders.set('Authorization', `Bearer ${accessToken}`)
  }
  return newHeaders
}

/**
 * Refresh the token against a given endpoint.
 *
 * Given as an argument to make it easier to later support multiple token stores
 * @param {string} tokenEndpoint - A URL to query for refresh tokens.
 */
async function refreshToken(tokenEndpoint) {
  try {
    const db = await store()

    sendMessage({ type: 'refreshingToken' })
    return await fetch(tokenEndpoint, {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/x-www-form-urlencoded'
      }),
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: await db.get('token_store', 'refresh_token')
      })
    })
  } catch (e) {
    console.error(e)
    sendMessage({ type: 'refreshTokenError' })
  }
}

/**
 * Parse the token response and store values as needed
 *
 * Also updates the expiry time and sends messages to other clients as needed
 * @param {Response} originalResponse - A token response to parse. This is
 * cloned to get around the body being locked when we read it.
 */
async function handleTokenResponse(originalResponse) {
  try {
    const response = originalResponse.clone()
    const db = await store()

    if (response.status >= 400 && response.status < 600) {
      throw new Error(`Token request failed. ${await response.text()}`)
    }

    const { access_token, refresh_token, expires_in } = await response.json()

    const tx = db.transaction('token_store', 'readwrite')
    await Promise.all([
      tx.store.put(access_token, 'access_token'),
      tx.store.put(refresh_token, 'refresh_token'),
      tx.store.put({ expires_in, date: currentTime() }, 'expiry'),
      tx.done
    ])
    sendMessage({ type: 'accessTokenStored' })
  } catch (e) {
    console.error(e)
    sendMessage({ type: 'accessTokenError' })
  }
}

// Register the plugin handler to handle token responses for valid endpoints
registerRoute(new Route(
  ({ request }) => request.url.includes('/oauth/token'),
  new NetworkOnly({
    plugins: [
      {
        fetchDidSucceed: async ({ request, response }) => {
          try {
            const db = await store()
            const config = await db.get('config', request.url)

            if (config && config.token_endpoint === request.url) {
              await handleTokenResponse(response)
            }
            return response
          } catch (e) {
            console.error(e)
          }
        }
      }
    ]
  }), 'POST'))

/**
 * Clear out the current token store
 */
async function clearToken() {
  try {
    const db = await store()
    await db.clear('token_store')

    sendMessage({ type: 'accessTokenCleared' })
  } catch (e) {
    sendMessage({ type: 'clearTokenError' })
  }
}

/**
 * Send a message to all clients registered for this Service Worker
 * @param {object} message - Message object to send.
 */
function sendMessage(message) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage(message)
    })
  })
}

// Create an event listener to handle all messages (counterpart to the above)
self.addEventListener('message', async (event) => {
  const type = event.data.type
  const db = await store()

  switch (type) {
    case 'storeConfig':
      await db.put('config', event.data.config, event.data.config.token_endpoint)
      break
    case 'clearToken':
      await clearToken()
      break
    default:
      console.error('type:', type, 'not handled')
  }
})

/**
 * Intercept all fetch events to attempt to attach our token by querying all
 * configs and finding one with a resource server the same as the origin of our
 * request
 *
 * Handles token expiry and will retry requests that 401 once to attempt to get
 * a new token first
 */
self.addEventListener('fetch', (event) => {
  event.respondWith((async () => {
    const request = event.request

    try {
      const db = await store()
      let cursor = await db.transaction('config').store.openCursor()

      while (cursor) {
        if (request.url.startsWith(cursor.value.resource_server)) {
          const accessToken = await db.get('token_store', 'access_token')
          if (accessToken) {
            const { date, expires_in } = await db.get('token_store', 'expiry')

            if (currentTime() - date > expires_in) {
              const response = await refreshToken(cursor.value.token_endpoint)
              await handleTokenResponse(response)
            }

            const headers = createHeaders(request.headers, await db.get('token_store', 'access_token'))
            const retryResponse = await fetch(new Request(request, { headers }))

            if (retryResponse.status === 401) {
              await handleTokenResponse(await refreshToken(cursor.value.token_endpoint))
              const headers = createHeaders(request.headers, await db.get('token_store', 'access_token'))
              return await fetch(new Request(request, { headers }))
            }
            return retryResponse
          } else {
            await handleTokenResponse(await refreshToken(cursor.value.token_endpoint))
            const headers = createHeaders(request.headers, await db.get('token_store', 'access_token'))
            return await fetch(new Request(request, { headers }))
          }
        }
        cursor = await cursor.continue()
      }
    } catch (error) {
      console.warn('Something went wrong trying to refresh token')
      console.warn(error)
    }

    return await fetch(request)
  })())
})
