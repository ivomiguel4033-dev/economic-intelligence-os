#!/usr/bin/env node
// Regression checks: invalid release evidence must never pass the CLI gate.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, linkSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./check-production-release-evidence.mjs", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), "release-evidence-input-"));

function expectRejected(path, label, reason = /Release evidence gate FAILED:/) {
  const result = spawnSync(process.execPath, [validator, path], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, label + ": process error");
  assert.equal(result.status, 1, label + ": must fail closed");
  assert.match(result.stderr, reason, label);
}

function expectAccepted(path, label) {
  const result = spawnSync(process.execPath, [validator, path], {
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.error, undefined, label + ": process error");
  assert.equal(result.status, 0, label + ": valid evidence must pass");
  assert.match(result.stdout, /Release evidence fields complete/, label);
}

try {
  expectRejected(join(directory, "missing.json"), "Missing evidence file");
  for (const [name, body] of [
    ["malformed.json", "{not-json"],
    ["empty.json", ""],
    ["array.json", "[]"],
    ["null.json", "null"],
  ]) {
    const path = join(directory, name);
    writeFileSync(path, body);
    expectRejected(path, name);
  }
  const invalidUtf8 = join(directory, "invalid-utf8.json");
  writeFileSync(invalidUtf8, Buffer.concat([
    Buffer.from('{"note":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}'),
  ]));
  expectRejected(invalidUtf8, "Malformed UTF-8 evidence", /encoded as valid UTF-8/);
  // Overlong UTF-8 encodings and isolated continuation bytes must fail closed.
  // Permissive decoders may normalize these bytes before JSON parsing.
  for (const [name, bytes] of [
    ["overlong-utf8.json", [0xc0, 0xaf]],
    ["isolated-continuation-utf8.json", [0x80]],
  ]) {
    const path = join(directory, name);
    writeFileSync(path, Buffer.concat([
      Buffer.from(JSON.stringify({ commitSha: "a".repeat(40) })),
      Buffer.from(bytes),
    ]));
    expectRejected(path, name, /encoded as valid UTF-8/);
  }
  // Truncated multibyte sequences must fail strict decoding rather than be replaced.
  // A complete, schema-valid record with a trailing newline remains acceptable.
  const truncatedUtf8 = join(directory, "truncated-utf8.json");
  writeFileSync(truncatedUtf8, Buffer.concat([
    Buffer.from(JSON.stringify({ commitSha: "a".repeat(40) })),
    Buffer.from([0xe2, 0x82]),
  ]));
  expectRejected(truncatedUtf8, "Truncated UTF-8 evidence", /encoded as valid UTF-8/);
  // A UTF-8 BOM must not be silently discarded by the decoder before JSON parsing.
  const bomPath = join(directory, "bom-evidence.json");
  writeFileSync(bomPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ commitSha: "a".repeat(40) }))]));
  expectRejected(bomPath, "UTF-8 BOM evidence", /must not include a UTF-8 BOM/);
  const oversized = join(directory, "oversized.json");
  writeFileSync(oversized, JSON.stringify({ note: "x".repeat(70_000) }));
  expectRejected(oversized, "Oversized evidence file", /Release evidence file exceeds 65536 bytes/);

  // Exercise the exact byte boundary with a complete, valid release record.
  // A valid 64 KiB record must pass, while one additional byte must fail.
  const validRecord = {
    commitSha: "a".repeat(40),
    ciRunUrl: "https://github.com/ivomiguel4033-dev/economic-intelligence-os/actions/runs/123",
    railwayDeploymentId: "railway_8f3a2",
    firstLaunch: true,
    rollbackVerified: false,
    ciPassed: true,
    stagedChangesReviewed: true,
    preflightPassed: true,
    oidcVerified: true,
    aiVerified: true,
    postgresReady: true,
    backupVerified: true,
    migrationReviewed: true,
    smokePassed: true,
    postReleaseObservationPassed: true,
  };

  // A green smoke test alone is insufficient to promote a release: operational
  // recovery and post-release observation must also be independently verified.
  for (const gate of ["backupVerified", "postReleaseObservationPassed"]) {
    const path = join(directory, `failed-${gate}.json`);
    writeFileSync(path, JSON.stringify({ ...validRecord, [gate]: false }));
    expectRejected(path, `Failed release gate: ${gate}`,
      new RegExp(`Missing or failed release gate: ${gate}`));
  }

  // A syntactically valid release record cannot override a failed smoke gate.
  // Exercise the CLI boundary to prevent accidental approval during rollout.
  const failedSmokePath = join(directory, "failed-smoke.json");
  writeFileSync(failedSmokePath, JSON.stringify({
    ...validRecord, smokePassed: false,
  }));
  expectRejected(failedSmokePath, "Failed production smoke test", /Missing or failed release gate: smokePassed/);

  // CI evidence must point to this repository, not an unrelated green workflow.
  const foreignCiPath = join(directory, "foreign-ci-run.json");
  writeFileSync(foreignCiPath, JSON.stringify({
    ...validRecord,
    ciRunUrl: "https://github.com/another-org/another-repo/actions/runs/123",
  }));
  expectRejected(foreignCiPath, "Unrelated CI workflow", /CI evidence must link to a run in this repository/);

  // Template deployment IDs must fail at the CLI boundary, even with all gates true.
  const placeholderPath = join(directory, "placeholder-deployment.json");
  writeFileSync(placeholderPath, JSON.stringify({
    ...validRecord, railwayDeploymentId: "deployment-example",
  }));
  expectRejected(placeholderPath, "Placeholder deployment ID", /Railway deployment ID is required/);
  const placeholderRollbackPath = join(directory, "placeholder-rollback.json");
  writeFileSync(placeholderRollbackPath, JSON.stringify({
    ...validRecord, firstLaunch: false, rollbackVerified: true,
    rollbackDeploymentId: "previous-deployment",
  }));
  expectRejected(placeholderRollbackPath, "Placeholder rollback ID", /Upgrades require a recorded rollback deployment ID/);

  // First deployments have no previously verified rollback target. Reject
  // contradictory evidence rather than approving a fabricated recovery plan.
  const firstLaunchRollbackPath = join(directory, "first-launch-with-rollback.json");
  writeFileSync(firstLaunchRollbackPath, JSON.stringify({
    ...validRecord, rollbackDeploymentId: "railway_previous_7b2",
  }));
  expectRejected(firstLaunchRollbackPath, "First launch cannot claim rollback target",
    /First launch cannot claim an existing rollback target/);
  const firstLaunchVerifiedPath = join(directory, "first-launch-rollback-verified.json");
  writeFileSync(firstLaunchVerifiedPath, JSON.stringify({
    ...validRecord, rollbackVerified: true,
  }));
  expectRejected(firstLaunchVerifiedPath, "First launch cannot claim verified rollback",
    /First launch requires rollbackVerified=false/);

  // Upgrades must have an independently identified and verified rollback target.
  // Exercise the real CLI, not only the validator's in-process self-test.
  const upgradePath = join(directory, "verified-upgrade.json");
  writeFileSync(upgradePath, JSON.stringify({
    ...validRecord, firstLaunch: false, rollbackVerified: true,
    rollbackDeploymentId: "railway_previous_7b2",
  }));
  expectAccepted(upgradePath, "Upgrade with verified distinct rollback deployment");
  const sameRollbackPath = join(directory, "same-rollback.json");
  writeFileSync(sameRollbackPath, JSON.stringify({
    ...validRecord, firstLaunch: false, rollbackVerified: true,
    rollbackDeploymentId: validRecord.railwayDeploymentId,
  }));
  expectRejected(sameRollbackPath, "Upgrade cannot roll back to itself", /Rollback deployment must differ/);
  // Railway UUIDs in canonical and compact notation identify the same deployment.
  // The release gate must reject that alias as a rollback destination.
  const equivalentUuidRollbackPath = join(directory, "equivalent-uuid-rollback.json");
  writeFileSync(equivalentUuidRollbackPath, JSON.stringify({
    ...validRecord,
    firstLaunch: false,
    rollbackVerified: true,
    railwayDeploymentId: "123e4567-e89b-42d3-a456-426614174000",
    rollbackDeploymentId: "123E4567E89B42D3A456426614174000",
  }));
  expectRejected(equivalentUuidRollbackPath, "Equivalent UUID rollback alias", /Rollback deployment must differ/);

  // A successful upgrade cannot be approved without a concrete recovery target.
  // Missing and empty rollback IDs must fail even when verification is claimed.
  for (const [name, rollbackDeploymentId] of [
    ["missing-rollback-id.json", undefined],
    ["empty-rollback-id.json", ""],
  ]) {
    const path = join(directory, name);
    const record = { ...validRecord, firstLaunch: false, rollbackVerified: true };
    if (rollbackDeploymentId !== undefined) record.rollbackDeploymentId = rollbackDeploymentId;
    writeFileSync(path, JSON.stringify(record));
    expectRejected(path, name, /Upgrades require a recorded rollback deployment ID/);
  }

  const unverifiedRollbackPath = join(directory, "unverified-rollback.json");
  writeFileSync(unverifiedRollbackPath, JSON.stringify({
    ...validRecord, firstLaunch: false, rollbackVerified: false,
    rollbackDeploymentId: "railway_previous_7b2",
  }));
  expectRejected(unverifiedRollbackPath, "Upgrade requires rollback verification", /rollbackVerified=true/);

  // Standard JSON trailing line endings are valid operational evidence files.
  // They must not be confused with malformed encodings or rejected by the CLI.
  for (const [name, ending] of [
    ["trailing-lf.json", "\n"],
    ["trailing-crlf.json", "\r\n"],
  ]) {
    const path = join(directory, name);
    writeFileSync(path, JSON.stringify(validRecord) + ending);
    expectAccepted(path, name);
  }

  // JSON permits surrounding whitespace, including CRLF and tab characters.
  // Keep this fixture executable so CI actually checks the acceptance path.
  const whitespacePath = join(directory, "json-whitespace.json");
  writeFileSync(whitespacePath, "\t \r\n" + JSON.stringify(validRecord) + "\n\t ");
  expectAccepted(whitespacePath, "JSON with surrounding whitespace");

  // JSON allows CR-only line separators and spaces around structural tokens.
  // A release gate must accept this standards-compliant formatting from operators.
  const crWhitespacePath = join(directory, "json-cr-whitespace.json");
  writeFileSync(crWhitespacePath, "\r " + JSON.stringify(validRecord) + " \r");
  expectAccepted(crWhitespacePath, "JSON with CR-only surrounding whitespace");

  // A UTF-8 encoding of a surrogate code point is invalid even though its
  // three-byte sequence superficially resembles a normal multibyte character.
  const surrogatePath = join(directory, "utf8-surrogate.json");
  writeFileSync(surrogatePath, Buffer.concat([
    Buffer.from(JSON.stringify(validRecord)),
    Buffer.from([0xed, 0xa0, 0x80]),
  ]));
  expectRejected(surrogatePath, "UTF-8 surrogate encoding", /encoded as valid UTF-8/);

  // UTF-8 code points above U+10FFFF are invalid, even when encoded as
  // a structurally complete four-byte sequence.
  const outOfRangePath = join(directory, "utf8-out-of-range.json");
  writeFileSync(outOfRangePath, Buffer.concat([
    Buffer.from(JSON.stringify(validRecord)),
    Buffer.from([0xf4, 0x90, 0x80, 0x80]),
  ]));
  expectRejected(outOfRangePath, "Out-of-range UTF-8 code point", /encoded as valid UTF-8/);

  // Overlong UTF-8 encodings must not be accepted as alternate byte forms
  // of otherwise valid ASCII characters in release evidence.
  const overlongUtf8Path = join(directory, "utf8-overlong.json");
  writeFileSync(overlongUtf8Path, Buffer.concat([
    Buffer.from(JSON.stringify(validRecord)),
    Buffer.from([0xc0, 0xaf]),
  ]));
  expectRejected(overlongUtf8Path, "Overlong UTF-8 sequence", /encoded as valid UTF-8/);

  // Evidence must not be modifiable by unrelated local users or group members.
  // Read-only group access is allowed; removing write access restores approval.
  if (process.platform !== "win32") {
    const writablePath = join(directory, "world-writable-evidence.json");
    writeFileSync(writablePath, JSON.stringify(validRecord));
    chmodSync(writablePath, 0o666);
    expectRejected(writablePath, "World-writable evidence", /must not be group- or world-writable/);
    chmodSync(writablePath, 0o660);
    expectRejected(writablePath, "Group-writable evidence", /must not be group- or world-writable/);
    chmodSync(writablePath, 0o640);
    expectAccepted(writablePath, "Group-readable evidence file");
    chmodSync(writablePath, 0o600);
    expectAccepted(writablePath, "Private evidence file");
  }

  // A hard link can alter reviewed evidence via another filename despite safe mode bits.
  // Once the alias is removed, the original single-link file must pass again.
  if (process.platform !== "win32") {
    const hardlinkSource = join(directory, "hardlink-source.json");
    const hardlinkAlias = join(directory, "hardlink-alias.json");
    writeFileSync(hardlinkSource, JSON.stringify(validRecord));
    linkSync(hardlinkSource, hardlinkAlias);
    expectRejected(hardlinkSource, "Hard-linked evidence source", /must not have multiple hard links/);
    expectRejected(hardlinkAlias, "Hard-linked evidence alias", /must not have multiple hard links/);
    unlinkSync(hardlinkAlias);
    expectAccepted(hardlinkSource, "Single-link evidence after alias removal");
  }

  // Duplicate release gates can be interpreted differently by operators and parsers.
  // JSON.parse would silently keep the last value and approve the record.
  const duplicateGatePath = join(directory, "duplicate-smoke-gate.json");
  writeFileSync(duplicateGatePath, JSON.stringify(validRecord).replace(
    '"smokePassed":true', '"smokePassed":false,"smokePassed":true',
  ));
  expectRejected(duplicateGatePath, "Duplicate smoke gate", /Duplicate top-level release evidence field: smokePassed/);

  // Escaped JSON member names must be compared after decoding.
  const escapedKey = '"ci' + String.fromCharCode(92) + 'u0050assed":true';
  const escapedGatePath = join(directory, "escaped-duplicate-ci-gate.json");
  writeFileSync(escapedGatePath, JSON.stringify(validRecord).replace(
    '"ciPassed":true', '"ciPassed":false,' + escapedKey,
  ));
  expectRejected(escapedGatePath, "Escaped duplicate CI gate", /Duplicate top-level release evidence field: ciPassed/);

  // Duplicate nested keys must be rejected before the schema rejects unknown metadata.
  // This catches ambiguity even when the duplicate key is hidden inside an object.
  const nestedDuplicatePath = join(directory, "nested-duplicate-metadata.json");
  writeFileSync(nestedDuplicatePath, JSON.stringify(validRecord).slice(0, -1) +
    ',"metadata":{"smokePassed":false,"smokePassed":true}}');
  expectRejected(nestedDuplicatePath, "Nested duplicate evidence key",
    /Duplicate nested release evidence field: smokePassed/);

  // Unknown metadata must be rejected even when nested keys are not duplicates.
  const nestedKeyPath = join(directory, "nested-metadata.json");
  writeFileSync(nestedKeyPath, JSON.stringify({
    ...validRecord, metadata: { smokePassed: false }, note: 'text with "ciPassed": false',
  }));
  expectRejected(nestedKeyPath, "Undocumented nested metadata and quoted text", /Unknown release evidence field: metadata/);

  // JSON whitespace is permitted without introducing undocumented evidence fields.
  // Test the exact 64 KiB input boundary with a schema-valid record.
  const unpaddedBody = JSON.stringify(validRecord);
  const paddingLength = 65_536 - Buffer.byteLength(unpaddedBody, "utf8");
  assert.ok(paddingLength > 0, "Valid evidence fits within the byte limit");
  const boundaryBody = unpaddedBody + " ".repeat(paddingLength);
  assert.equal(Buffer.byteLength(boundaryBody, "utf8"), 65_536);
  const boundaryPath = join(directory, "exactly-65536.json");
  writeFileSync(boundaryPath, boundaryBody);
  expectAccepted(boundaryPath, "Valid evidence exactly at 64 KiB");
  const oneByteOver = join(directory, "65537.json");
  writeFileSync(oneByteOver, boundaryBody + " ");
  expectRejected(oneByteOver, "Valid evidence exceeding the byte limit by one", /Release evidence file exceeds 65536 bytes/);

  // Evidence must be an actual file, not a directory, a symlink or a blocking FIFO.
  expectRejected(directory, "Directory cannot be release evidence", /regular file/);
  if (process.platform !== "win32") {
    const linkPath = join(directory, "linked-evidence.json");
    symlinkSync(boundaryPath, linkPath);
    expectRejected(linkPath, "Symlink must not redirect release evidence");
  }
  if (process.platform === "linux") {
    const fifoPath = join(directory, "pipe-evidence.json");
    const created = spawnSync("mkfifo", [fifoPath], { timeout: 5000 });
    assert.equal(created.error, undefined, "FIFO fixture command must execute");
    assert.equal(created.status, 0, "FIFO fixture must be created");
    expectRejected(fifoPath, "FIFO evidence must fail without blocking", /regular file/);
  }
  console.log("Production release evidence input regression checks passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
