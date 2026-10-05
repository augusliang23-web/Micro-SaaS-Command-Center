FROM cc-verifier:phase3b3b1
COPY bootstrap.mjs snapshotInventory.mjs approvedIdentity.mjs runner.mjs verificationProfile.mjs /opt/cc-verifier/
RUN --network=none /usr/local/bin/node --check /opt/cc-verifier/runner.mjs && /usr/local/bin/node --check /opt/cc-verifier/verificationProfile.mjs
