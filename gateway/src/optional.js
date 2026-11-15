'use strict';

function requireOptional(name) {
  try {
    return require(name);
  } catch (error) {
    throw new Error(
      `Dependência opcional "${name}" não instalada. Execute "npm install" em gateway/.`
    );
  }
}

module.exports = {
  requireOptional,
};
