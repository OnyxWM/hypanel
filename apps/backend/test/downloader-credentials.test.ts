import assert from "node:assert/strict";
import { isLikelyCredentialAuthFailure } from "../src/downloader/downloaderCredentials.js";

function runDownloaderCredentialTests(): void {
  const positiveCases = [
    "oauth error: invalid_grant",
    "request failed: invalid_token returned by server",
    "refresh token expired, please authenticate again",
    "received 401 unauthorized while refreshing oauth credentials",
    "stored credentials are invalid and authentication failed",
  ];

  const negativeCases = [
    "",
    "download timed out after 30 minutes",
    "network connection reset by peer",
    "received 401 from unrelated upstream service",
    "filesystem permission denied while writing zip file",
  ];

  positiveCases.forEach((value) => {
    assert.equal(
      isLikelyCredentialAuthFailure(value),
      true,
      `Expected auth failure match for: ${value}`
    );
  });

  negativeCases.forEach((value) => {
    assert.equal(
      isLikelyCredentialAuthFailure(value),
      false,
      `Expected non-auth failure for: ${value}`
    );
  });

  console.log("Downloader credential auth failure tests passed.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDownloaderCredentialTests();
}

export { runDownloaderCredentialTests };
