'use strict';

if (process.env.NODE_ENV === "production") {
  module.exports = require("./luciodale-oauth2.cjs.prod.js");
} else {
  module.exports = require("./luciodale-oauth2.cjs.dev.js");
}
