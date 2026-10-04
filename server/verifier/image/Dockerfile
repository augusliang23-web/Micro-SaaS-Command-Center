# Only the explicitly approved base; no other image or syntax image is fetched.
FROM node@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c
WORKDIR /opt/cc-verifier/deps
COPY package.json package-lock.json ./
COPY empty-user.npmrc empty-global.npmrc /opt/cc-verifier/
# Administrative dependency download from approved manifests only. No lifecycle scripts.
RUN npm ci --ignore-scripts --include=dev --include=optional --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/opt/cc-verifier/empty-user.npmrc --globalconfig=/opt/cc-verifier/empty-global.npmrc && rm -rf /root/.npm
COPY bootstrap.mjs snapshotInventory.mjs approvedIdentity.mjs capabilities.mjs /opt/cc-verifier/
ENV PATH=/usr/local/bin:/usr/bin:/bin
USER 1000:1000
# Administrative native checks only; no repository source or project test/build command is present.
RUN --network=none /usr/local/bin/node /opt/cc-verifier/capabilities.mjs
WORKDIR /workspace
ENTRYPOINT ["/usr/bin/env", "--"]
CMD ["/usr/local/bin/node", "/opt/cc-verifier/bootstrap.mjs"]
