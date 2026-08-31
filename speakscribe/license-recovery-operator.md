# SpeakScribe activation-recovery operator runbook

This runbook is the release and support procedure for an activation whose
Lemon Squeezy response was ambiguous. It implements the recovery-readiness
gate in `PUBLISHING.md`; it does not relax that gate. Keep the checked-in
`js/release-config.js` fail closed (`version: 1`, `testMode: false`,
`plans: []`, `activationRecoveryPublicJwk: null`), keep checkout disabled, and keep new
activation paused until this procedure, its access controls, and both drills
below are signed off.

The recovery code is only a locator. It is not a password, proof of purchase,
or proof that the person asking for help controls the checkout account.

## Safety invariants

1. Work on exactly one pending operation and the exact Lemon Squeezy instance
   label `SpeakScribe Chrome / <recovery-code>`.
2. Authenticate the operator and independently verify the customer against the
   checkout account before inspecting or changing an instance.
3. Require the configured store, product, and variant tuple to match exactly.
   A product name, amount, or plan label is not an acceptable substitute.
4. Treat an interrupted request, incomplete result page, malformed response,
   timeout, rate limit, or service error as **unknown**. Unknown is not
   "not found." Do not issue a receipt or tell the customer to retry.
5. Never put a full license key in a command-line argument, URL, ticket, chat,
   screenshot, clipboard manager, shell history, or log. Turn off shell tracing
   before handling secrets.
6. Do not clear the extension's encrypted activation journal until a valid
   recovery receipt has been accepted. A browser or service-worker restart
   must leave an unresolved operation blocked.

## Trust boundary and access

The recovery tool is an operator-only administrative tool. Run it from a
managed workstation or a locked-down support runner; do not expose it as a
public endpoint. Access is limited to named release/support operators with
MFA, a separate Lemon Squeezy role or API credential, and access to the signing
key. Review access quarterly and immediately remove departed or reassigned
operators.

Use distinct secret-manager entries and catalog configuration for test and
live mode. The required `--mode test|live` has no default, and every remote
resource must match it; a mode flag never turns a test tuple into a live one.
An operator who may inspect an incident does not automatically need
permission to mutate an instance or rotate the receipt-signing key. Require a
second operator for live key rotation and for any exceptional action that is
not tied to a customer-authenticated support case.

Before any lookup, support must establish all of the following outside the
tool:

- the requester controls the checkout email, normally through Lemon Squeezy
  My Orders or a reply to a newly resent message sent only to that address;
- the order/subscription is active and belongs to SpeakScribe Pro;
- the support case records the operator, mode, and internal case identifier;
- the recovery code displayed by the extension matches the pending operation.

An order number, forwarded receipt, recovery code, instance ID, or displayed
masked key alone is insufficient. Do not ask a customer to post any of them
publicly.

## Catalog configuration

Configure an allowlist of complete tuples, never three independent lists. Each
entry is:

```text
<store-id>:<product-id>:<variant-id>
```

The CLI enforces this policy through one mode-specific environment value:

- `SPEAKSCRIBE_RECOVERY_LIVE_CATALOG_JSON` for `--mode live`; or
- `SPEAKSCRIBE_RECOVERY_TEST_CATALOG_JSON` for `--mode test`.

The selected value is a nonempty JSON array containing at most 32 exact objects
with only the string fields `storeId`, `productId`, and `variantId`, for example
`[{"storeId":"100","productId":"200","variantId":"300"}]`. Missing,
empty, malformed, duplicate, extra-field, noncanonical, wrong-mode, or unlisted
configuration fails before signer loading, API-client construction, or any
network request. Do not make the list from operator-supplied command values.

For launch, the live allowlist contains only the verified $9.99 monthly and
$89.99 yearly recurring variants. Do not include retired test identifiers,
lifetime or one-time variants, or future cloud entitlements. Confirm the live
variant is `published` and reports `test_mode: false` through the authenticated
Lemon Squeezy API. A `pending` variant is not eligible for recovery.
The test configuration must contain only test tuples and use a distinct
administrative credential when Lemon Squeezy supports that scope; otherwise,
keep the shared credential in one controlled secret and rely on the mandatory
mode and exact-resource checks rather than copying it into drill configuration.

Record the approved tuples in the release ticket. The operator tool's tuple,
the receipt tuple, the remote license/order tuple, and—after the release gate
is lifted—the tuple in the extension must all be identical. Any partial match
or mode mismatch is a hard stop.

## Receipt-signing keys

Recovery receipts use ECDSA P-256 with SHA-256. Generate the key pair on a
managed offline workstation. The current CLI accepts a standard unencrypted
PKCS#8 (`BEGIN PRIVATE KEY`) or SEC1 (`BEGIN EC PRIVATE KEY`) private PEM. The
private signing key is operator-only and must remain in the secret manager; it
must never be committed, copied into extension storage, bundled in `dist`, or
placed in Railway. The extension contains only the public JWK. A future HSM/KMS
signer requires a separately reviewed integration; do not improvise one around
this CLI.

For a file-backed key on an approved offline workstation, this generates a
PKCS#8 P-256 private key with restrictive permissions and prints its public JWK:

```bash
umask 077
openssl genpkey -algorithm EC \
  -pkeyopt ec_paramgen_curve:P-256 \
  -out /approved/secret/path/speakscribe-recovery-p256.pem
openssl pkey \
  -in /approved/secret/path/speakscribe-recovery-p256.pem \
  -check -noout
node --input-type=module -e '
  import { createPublicKey } from "node:crypto";
  import { readFileSync } from "node:fs";
  const publicKey = createPublicKey(readFileSync(process.argv[1]));
  const jwk = publicKey.export({ format: "jwk" });
  process.stdout.write(`${JSON.stringify(jwk)}\n`);
' /approved/secret/path/speakscribe-recovery-p256.pem
```

Import the private PEM into the secret manager, verify the import, and securely
delete the workstation copy under the organization's media-sanitization
procedure. A mounted key must be a nonsymlink, regular file owned by the
current operator, no larger than 32 KiB, with no group or other permissions.
Never redirect the private key to a path inside the repository.

After generation:

1. Verify the curve is P-256. The public JWK must have `kty: "EC"`,
   `crv: "P-256"`, base64url `x` and `y`, no `d`, and only compatible optional
   signing metadata (`alg: "ES256"`, `use: "sig"`, `key_ops: ["verify"]`, and
   `ext: true`).
2. Store the private key and Lemon Squeezy administrative credential as
   different secrets with separate access audit trails.
3. After live-drill and release approval, put only the reviewed public JWK in
   `activationRecoveryPublicJwk` in `js/release-config.js`. It intentionally
   remains `null` in the disabled production config. Never edit the derived
   `ACTIVATION_RECOVERY_PUBLIC_JWK` consumer in `js/license.js`.
4. Build the extension and search the complete artifact for the private JWK,
   private-key material, administrative token, and test secrets. Any match
   blocks release.
5. Sign a fixture receipt and verify it in a clean extension profile before
   enabling any catalog tuple.

### Rotation

Receipt signatures do not carry a key identifier, so rotation is a coordinated
release, not an unannounced secret swap. Use this order:

1. Generate a new pair and record the rotation case and approvers.
2. Pause receipt issuance. Finish or explicitly leave blocked every open
   recovery case.
3. Wait until every receipt signed by the old key has expired, plus the allowed
   clock-skew window.
4. Publish and verify the extension build containing the new public JWK. Keep
   paid activation paused through the Chrome staged-update window.
5. Switch the operator signing secret only after the intended installed-version
   adoption threshold is reached, then run a signed-fixture check. Require any
   customer still on the old public-key build to update before receiving a new
   receipt; do not issue a knowingly unverifiable receipt.
6. Revoke and delete the old private key under the secret-manager retention
   policy. Record its deletion and the first successful receipt from the new
   key.

If an old signing key may have been exposed, stop issuing receipts, keep
activation blocked, revoke the key, and treat every unexpired receipt as
untrusted. Do not resume until a new public key has shipped and the incident
review is complete.

## Exact recovery inputs

For every operation, collect these values directly from the authoritative
sources shown here:

| Input | Source | Rule |
| --- | --- | --- |
| `--mode` | Operator-selected test or live secret profile | Required; exactly `test` or `live`, with no default. The tool verifies the corresponding Lemon `test_mode` on every resource that exposes it. |
| `--operation-id` | The blocked extension screen | Use the complete 16–128-character recovery code matching `[A-Za-z0-9_-]{16,128}`. A short value, dot, tilde, space, or other character is invalid. It derives the exact label `SpeakScribe Chrome / <operationId>`. |
| `--order-id` | Authenticated Lemon Squeezy order | Use the exact canonical positive safe-integer identifier matching `^[1-9][0-9]{0,15}$`; an order number supplied by the requester is not authoritative. |
| `--customer-email` | Authenticated Lemon Squeezy order | Use the byte-for-byte exact checkout email after proving the requester controls it; the CLI does not trim or change case. |
| `--license-key-short` | Customer's private Lemon receipt/My Orders or the authorized operator's Lemon dashboard | Exactly Lemon Squeezy's masked `XXXX-` plus the final 12 alphanumeric key characters, never the full key. The extension intentionally shows only the last four, so do not infer this input from its recovery screen. |
| `--store-id`, `--product-id`, `--variant-id` | Approved mode-specific tuple | Canonical positive safe-integer digit strings matching `^[1-9][0-9]{0,15}$`, with no sign, space, or leading zero; the three IDs are one indivisible tuple. |
| `--issue-receipt` | Operator decision after definitive inspection | Optional; exactly `clear` or `adopt`. Omit during the first read-only inspection. |
| `--rollback-exact-instance` | A `recoverable` inspection result | Optional version 1–8, RFC-variant Lemon instance UUID. Case-insensitive input is validated and immediately normalized to canonical lowercase. It authorizes deactivation of only that instance and is accepted only together with `--issue-receipt clear`; an unpaired rollback is rejected before any request. |
| `--receipt-ttl-ms` | Fixed operating policy | Optional integer from `1000` through `900000`; default `300000` (five minutes), hard maximum 15 minutes. |
| Case ID | Restricted support system | Use a non-secret internal correlation ID; do not put it in the receipt. |

Whitespace, truncated IDs, names in place of numeric IDs, and a label with a
different prefix are invalid. Do not "fix" a mismatched remote label.

The SpeakScribe recovery screen supplies the operation code and a last-four
hint only. Support first correlates those against the authenticated private
order record, then obtains Lemon Squeezy's `XXXX-<last12>` form from My Orders,
the private customer receipt, or the authorized operator dashboard. Never ask
the customer to send or paste the full key.

### Environment and exact commands

Run from the repository root with Node.js 24 or newer. The administrative token
is accepted only through `LEMONSQUEEZY_ADMIN_API_TOKEN`; there is deliberately
no token flag. Populate it from the mode-specific secret manager without
putting its literal value in shell history. `--mode` is still mandatory and
must agree with the token, approved tuple, and all returned Lemon resources.
The same approved wrapper must inject exactly the selected
`SPEAKSCRIBE_RECOVERY_LIVE_CATALOG_JSON` or
`SPEAKSCRIBE_RECOVERY_TEST_CATALOG_JSON`; do not construct that JSON from the
command's tuple arguments.

For a receipt-issuing invocation, configure exactly one signer:

- `SPEAKSCRIBE_RECOVERY_SIGNING_KEY_FILE` is the preferred path to a
  secret-manager-mounted private PEM; or
- `SPEAKSCRIBE_RECOVERY_SIGNING_KEY_PEM` contains the private PEM for a runner
  that cannot mount a secret file.

Setting both or neither signer variables when issuing a receipt is an error.
Never store either value in `.env`, repository configuration, CI artifacts, or
Railway variables. Inspection does not print or accept the full license key;
the CLI deliberately accepts only `--license-key-short`. It retrieves the full
key transiently from the authenticated administrative API and sends it only to
Lemon Squeezy's public validation or deactivation endpoint when required.

Set the non-secret/restricted session variables through the approved support
wrapper, with terminal recording and shell tracing disabled. The initial
read-only command is:

```bash
node recovery-tool/bin/speakscribe-recovery.mjs inspect \
  --mode "$RECOVERY_MODE" \
  --operation-id "$RECOVERY_OPERATION_ID" \
  --order-id "$LEMON_ORDER_ID" \
  --customer-email "$CHECKOUT_EMAIL" \
  --license-key-short "$LICENSE_KEY_SHORT" \
  --store-id "$EXPECTED_STORE_ID" \
  --product-id "$EXPECTED_PRODUCT_ID" \
  --variant-id "$EXPECTED_VARIANT_ID"
```

After a fresh `recoverable` result, issue an adoption receipt by repeating the
same command with:

```bash
  --issue-receipt adopt
```

After a fresh `not_created` result, issue a clear receipt by repeating the same
command with:

```bash
  --issue-receipt clear
```

To roll back the one exact instance returned by a fresh `recoverable`
inspection and issue the clear receipt only after verification, repeat the
same command with both:

```bash
  --rollback-exact-instance "$EXACT_INSTANCE_ID" \
  --issue-receipt clear
```

The default receipt lifetime is five minutes. Do not override it during normal
support. If an approved accessibility or delivery path needs longer, append
`--receipt-ttl-ms <milliseconds>` with a positive value no greater than
`900000`, record the reason, and keep it as short as practical.

The command writes one redacted JSON object. It never prints the checkout
email, customer name, full key, administrative token, private key, or raw
upstream response. Do not pipe output to `tee`, paste it into the case, or
permit terminal capture. A receipt appears only in a successful
receipt-issuing result and must be transferred immediately through the
authenticated one-time support channel. A definitive result exits `0`, a
refused or unknown result exits `2`, a usage/secret configuration failure exits
`64`, and an unexpected internal failure exits `70`. Any nonzero exit keeps the
journal blocked.

The signing key is loaded and validated before the first Lemon Squeezy request
whenever `--issue-receipt` is present. Do not bypass that ordering: a bad or
unsafe signing key must fail before an exact-instance rollback can begin.

## Operator workflow

Start every case with the read-only command above and inspect its exact JSON
`outcome`:

- `not_created`: a complete, successful query found zero instances with the
  exact label for the verified order/license;
- `recoverable`: exactly one active instance matches the label, identity, and
  tuple and can be adopted or rolled back;
- `duplicate`: more than one license key matches the asserted identity or more
  than one remote instance matches the exact label, so no choice is safe;
- `identity_mismatch`: the order, checkout email, masked-key check, customer, or
  explicit rollback target conflicts;
- `catalog_mismatch`: the remote store/product/variant is not the complete
  expected tuple; or
- `unknown`: the remote result is incomplete or not authoritative.

Only `not_created` and `recoverable` are definitive recovery states.
`duplicate`, both mismatch outcomes, and `unknown` produce no receipt and
permit no mutation. Capture only the sanitized result class in the restricted
audit record, not in a public support response.

### Adopt an existing active instance

Use adoption only when inspection finds exactly one active instance and the
verified order/subscription remains eligible.

1. Repeat the exact-label inspection immediately before signing.
2. Verify the instance ID and full tuple against the authoritative response.
3. Repeat the command with `--issue-receipt adopt`. The emitted `adopt` receipt
   is bound to that `operationId`, derived instance name, exact instance ID, and
   tuple.
4. Deliver the receipt through an authenticated one-time support portal or a
   newly sent message to the verified checkout address. Do not send it to an
   arbitrary reply address or paste it into a ticket, analytics event, or
   general chat.
5. Have the customer import it before it expires. Confirm the extension
   verifies the signature and operation, saves and reopens the protected
   entitlement, removes the activation journal, and validates that exact
   instance.
6. A nonce already committed to the replay ledger must fail. If local
   persistence or cleanup fails, stop; do not create another remote instance.
   Follow the replay procedure below before issuing a replacement receipt.

### Roll back an existing instance

Use rollback when the customer does not want the ambiguous activation adopted,
or policy does not allow adoption.

1. Repeat inspection and target only the returned exact instance ID.
2. Request remote deactivation once.
3. Re-inspect Lemon Squeezy. A successful request response alone is not proof
   of rollback. Continue only when the exact instance is authoritatively shown
   as deactivated/absent and the full result was obtained.
4. The combined rollback command must return `outcome: "not_created"` with
   `resolution: "rolled_back"` before it emits a `clear` receipt. That receipt
   is bound to the original operation, derived instance name, and tuple, and
   carries an empty instance ID.
5. After the extension accepts it, verify that the activation journal and any
   partial paid records are gone and that another activation is allowed.

If the deactivation response is interrupted, the state is unknown. Do not
repeat the mutation blindly and do not issue a receipt; re-inspect first.

### Confirm that no instance was created

Issue a `clear` receipt with `instanceId: ""` only after a complete exact-label
inspection returns `not_created` for the verified order/license and tuple. This
receipt tells the extension that clearing the pending journal is safe; it does
not grant Pro access. A failed lookup, empty first page with an unreadable next
page, or broker outage never qualifies.

## Receipt contract

The customer-visible receipt is exactly:

```text
base64url(canonical-json).base64url(signature)
```

The payload is UTF-8 JSON with no insignificant whitespace and exactly these
members in this order, with no extras:

```text
version, outcome, operationId, instanceName, instanceId, storeId, productId,
variantId, testMode, issuedAt, expiresAt, nonce
```

The first segment is unpadded base64url of those canonical JSON bytes. The
second is unpadded base64url of the P-256 ECDSA signature over the exact
canonical JSON payload bytes, using SHA-256. The signature is IEEE P1363/raw
format: 64 bytes total, the 32-byte big-endian `r` followed by the 32-byte
big-endian `s`. A DER-encoded ECDSA signature is invalid.

The strict schema is:

- `version` is the integer `1`;
- `outcome` is exactly `clear` or `adopt`;
- `operationId` is the pending recovery code and matches exactly
  `[A-Za-z0-9_-]{16,128}`;
- `instanceName` is exactly `SpeakScribe Chrome / ${operationId}`;
- `instanceId` is the empty string for `clear` and the exact lowercase
  canonical Lemon instance UUID for `adopt`, matching
  `^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`;
- `storeId`, `productId`, and `variantId` are canonical positive safe-integer
  digit strings matching `^[1-9][0-9]{0,15}$`. For a live receipt, the tuple
  must match one of the two entries derived from
  `SpeakScribeReleaseConfig.plans`; for an operator run it must also match the
  selected mode-specific operator catalog JSON;
- `testMode` is the JSON boolean `true` for a test operation and `false` for a
  live operation; it is never a string;
- `issuedAt` and `expiresAt` are integer Unix milliseconds; and
- `nonce` is a newly generated lowercase canonical UUID matching the same
  version/variant-aware expression.

The signer is probed before any network request, but the final `issuedAt` is
sampled and the actual receipt is signed only after inspection or rollback has
reached its definitive state. This preserves the full intended receipt
lifetime even when reconciliation is slow.

The verifier rejects a malformed segment, padding, non-canonical encoding,
wrong member order or type, extra/missing member, unsupported version/outcome,
invalid instance representation, empty shipped catalog, non-allowlisted tuple,
disallowed test mode, bad signature, operation/instance-name mismatch,
`issuedAt` more than five minutes in the future, `expiresAt <= issuedAt`,
lifetime over 15 minutes, expiration, or replay. Never hand-edit a receipt.
The production client accepts only live receipts: `js/license.js` locks receipt
mode to `false`, and `js/release-config.js` must also have `testMode: false`.
Lemon's public license-validation response may omit `meta.test_mode`; if that field is present, it must be the
literal JSON boolean `false`. The extension
rejects `true`, the string `"false"`, and every other conflicting value.
Recovery application remains disabled when the checked-in release config is missing or malformed,
`plans` does not normalize to exactly the monthly and yearly live tuples, or
`activationRecoveryPublicJwk` is absent or invalid.

A receipt is authorization for one local pending operation, not a general
license credential. It is bound to the encrypted journal's `operationId` and
exact instance name; an adoption is also bound to the exact remote instance
and tuple. Before local mutation, the extension verifies the receipt while
holding its recovery lock and compare-and-swap boundary.

The replay ledger persists `{nonce, expiresAt}` with the local commit and is
checked across service-worker and browser restarts. The same still-unexpired
receipt may retry only if the previous attempt failed before its nonce was
persisted. Once the nonce is persisted, the receipt is a replay and is
rejected—even if a later commit barrier failed. In that state, re-inspect the
unchanged exact operation and issue a freshly signed receipt with a new nonce.
A different fresh receipt is valid only for that same still-pending exact
operation after all remote checks are repeated. Once the journal is cleared,
no receipt for it is applicable.

The default lifetime is five minutes and the hard maximum is 15 minutes.
Operator and customer clocks must be synchronized, and time is checked on
every application: `issuedAt` may be at most five minutes ahead of the device,
and the device time must not be later than `expiresAt`. There is no post-expiry
resume. If a receipt expires before the local operation commits, re-inspect the
remote state and issue a new receipt with a new nonce; never extend or re-sign
the old payload.

## Logging and retention

Before a drill or live case, verify request-body logging, shell tracing,
crash-dump upload, terminal recording, and HTTP debug output are disabled for
the recovery process. Redaction happens before serialization and before an
error reaches a logger. Error paths are subject to the same rule as successful
paths.

The permitted audit record is: case ID, named operator, mode, action name (not
the raw command or arguments), UTC time, result class, approved tuple, key
version held in the secret manager, and a non-secret error category. Look up
the exact instance in Lemon Squeezy when needed instead of duplicating it in
the long-lived audit record. Treat the
recovery code, instance label, instance ID, receipt, nonce, customer/order
metadata, and audit record as restricted operational data even though they are
not substitutes for a license key.

Use this launch retention schedule unless a stricter approved policy applies:

| Data | Retention |
| --- | --- |
| Full license key | Never supplied by the operator; retrieved transiently from Lemon Squeezy into process memory only, with zero persisted copies and zero logs. |
| Masked `XXXX-` plus final 12 key characters | Recovery command only; delete with working data and never treat as authentication. |
| Raw signing key and Lemon Squeezy credential | Secret manager for their approved lifetime; never in case records. |
| Raw recovery receipt | Deliver only through the authenticated channel; do not persist in tickets or logs. |
| Recovery code, label, nonce, and exact instance ID in recovery working data | Delete after the receipt expires and the case is confirmed, no later than 24 hours. |
| Sanitized support/audit record | 30 days, encrypted and access-controlled, then automatically delete. |
| Billing records in Lemon Squeezy | Governed by the separate billing/legal retention policy; do not duplicate them into recovery logs. |

Confirm the deletion job in both drills and sample it monthly. A legal or
security hold must be documented and access-restricted; it does not permit
retaining the full license key or signing secret in a ticket.

## Failure matrix

| Condition | Operator result | Customer/local action |
| --- | --- | --- |
| Bad input, identity not verified, or tuple/mode mismatch | Stop; no lookup or mutation beyond what is needed to identify the mismatch; no receipt. | Keep journal and activation blocked. |
| `not_created` after a complete successful inspection | A definitive `clear` receipt may be signed. | Import receipt; clear journal; retry only after acceptance. |
| One exact active match | Choose adopt or verified rollback according to the authenticated case. | Import the one-time receipt. |
| Multiple matches or conflicting customer/catalog state | Conflict; no mutation and no receipt. Escalate to billing/security. | Keep journal and activation blocked. |
| Timeout, 408/425/429/5xx, DNS/TLS error, malformed data, or incomplete pagination | Unknown; no receipt. | Keep journal and do not retry activation. |
| Deactivation request interrupted | Unknown; re-inspect before any further action. | Keep journal. |
| Remote rollback verified but signing fails | Do not retry the remote mutation. Restore signing service, re-inspect, then issue a `clear` receipt. | Keep journal until receipt is accepted. |
| Receipt expired, replayed, tampered, or for a different operation/tuple/instance | Client rejects it. Re-authenticate as needed and re-inspect before replacement. | Keep journal; never bypass verification. |
| Receipt accepted but entitlement write or journal cleanup fails | Do not activate again or repeat rollback blindly. Inspect local and remote state and escalate. | Restart must remain fail-closed. |
| Signing key or administrative credential suspected compromised | Stop the service, revoke affected secret, invoke incident response. | Keep activation paused until coordinated recovery. |

## Required drills and release evidence

### Test-mode drill first

The completed Test-mode drill is retained as historical prerequisite evidence.
Do not reproduce it by editing `js/license.js`, `js/release-config.js`, or any
checked-in production gate. The current `scripts/build-recovery-drill.js` is
intentionally live-only: it requires an external public drill config with
`testMode: false` and rejects Test-mode config. Any future Test-mode regression
exercise requires a separately reviewed, nonproduction harness and must leave
the checked-in production config and production bundle unchanged. Before and
after that exercise, verify the production config remains `version: 1`,
`testMode: false`, `plans: []`, and `activationRecoveryPublicJwk: null` until
live launch approval.

1. Confirm the order, customer, product, and variant resources that expose mode
   are test mode, their related IDs bind every other resource to the same mode,
   and the exact tuple is allowlisted only in the test operator and drill-build
   profiles.
2. Complete a test checkout and verify license delivery.
3. Interrupt activation after Lemon Squeezy can receive it but before the
   extension can finalize the response. Confirm the encrypted journal remains
   in `sending`, another activation is blocked, and the same recovery code
   survives service-worker and browser restarts.
4. Authenticate the test customer, inspect the exact label, adopt the one
   active instance, and import the signed receipt. Verify the exact instance
   and tuple are saved in protected records and the journal is removed.
5. Deactivate, create a second interrupted activation, perform verified remote
   rollback, and import its `clear` receipt. Also exercise the definitive
   `not_created`/`clear` branch without treating a simulated outage as
   not-found.
6. Verify repeated read-only inspection does not mutate state; multiple remote
   matches return `duplicate`; and expired, replayed, altered, wrong-operation,
   wrong-instance-name, wrong-instance, wrong-tuple, wrong-key, DER-signature,
   and overlong-lifetime receipts all fail closed across restarts. Exercise both
   permitted retry before nonce persistence and fresh-nonce recovery after a
   persisted nonce blocks replay.
7. Exercise timeout, interrupted deactivation, 408/425/429/5xx, malformed
   response, incomplete pagination, signing failure after rollback, and local
   cleanup failure. Each unknown state must retain the journal and block retry.
8. Inspect process lists, shell history, terminal output, crash reports,
   support records, analytics, and service logs. The full license key must
   appear nowhere, and the raw receipt must appear only in the authenticated
   one-time delivery channel.
9. Delete working data under the schedule above and attach sanitized evidence
   and two-operator sign-off to the release ticket.

### Live 100%-discount drill

Run this only after the test drill passes and while public checkout and
activation remain paused.

Create the two deterministic live-drill artifacts with
`scripts/build-recovery-drill.js`; do not edit `js/license.js`,
`js/release-config.js`, or any checked-in release gate. The builder consumes a
public-only JSON file outside the repository containing exactly `version: 1`,
`testMode: false`, two plans identified as `monthly` and `yearly` with only
`{id, storeId, productId, variantId}`, and the reviewed public P-256 JWK. Drill
plans intentionally omit `checkoutUrl`. The builder writes this config only to
the isolated artifact's `js/release-config.js`, injects the selected ambiguity
point only into that artifact, and rejects private material, repository-local
paths, existing output, or a missing non-publishable acknowledgement.
Generate separate unpacked directories for the two modes:

```bash
node scripts/build-recovery-drill.js \
  --mode post-create \
  --release-config /approved/public/drill-config.json \
  --output /approved/ephemeral/speakscribe-post-create-drill \
  --acknowledge I_UNDERSTAND_THIS_RECOVERY_DRILL_BUILD_MUST_NOT_BE_PUBLISHED

node scripts/build-recovery-drill.js \
  --mode pre-request \
  --release-config /approved/public/drill-config.json \
  --output /approved/ephemeral/speakscribe-pre-request-drill \
  --acknowledge I_UNDERSTAND_THIS_RECOVERY_DRILL_BUILD_MUST_NOT_BE_PUBLISHED
```

`post-create` requires a definitive Lemon activation-success response with an
instance ID, then deliberately discards it before the local `sending` journal
can record the instance. `pre-request` persists and verifies the same
`sending` journal but sends no activation request, producing the deterministic
no-instance branch. Both artifacts have visible `NON-PUBLISHABLE` manifest
labels and a root `RECOVERY_DRILL_DO_NOT_PUBLISH.txt` marker. The normal build
scans `dist/` and fails if either the injector sentinel or drill labels leak
into a production artifact. Load these directories unpacked only; never zip,
upload, distribute, or use them for ordinary activation.

1. From the reviewed release commit, use the builder commands above to create
   the `pre-request` and `post-create` unpacked artifacts. Verify each artifact
   contains `testMode: false`, only the two exact verified live tuples, and the
   reviewed public JWK in its generated `js/release-config.js`; contains no
   checkout URL, private key, administrative token, test tuple, or test public
   key; and is visibly marked non-publishable. Verify the checked-in
   `js/release-config.js` remains fail-closed and unchanged.
2. Record the product's initial Draft and hidden state. With the separately
   approved drill window open, temporarily publish product `1328136` and the
   selected recurring variant while keeping the product hidden and every
   public extension and website checkout URL absent. Re-query the authenticated
   API and require both resources to be `published` before using the operator
   tool. Use only an unshared checkout that expires at the end of the drill.
3. Select `--mode live` and create a temporary, single-use 100% discount for the
   verified live recurring Pro variant. Use a non-team checkout email and
   confirm every applicable authenticated resource reports `test_mode: false`,
   all related IDs bind to the same live data, and the exact approved tuple is
   used. Every issued live receipt must contain `testMode: false`.
4. Complete the real live checkout. Confirm that the non-team customer receives
   the receipt and license key; a message delivered only to the store team is a
   test-mode failure.
5. In a clean Chrome profile using the live-drill extension, produce a
   controlled ambiguous activation and verify restart persistence and retry
   blocking.
6. Run the full identity, exact-label, order-state, and tuple checks. Complete
   one adoption, validate the exact instance, then deactivate it.
7. Produce another controlled ambiguity, complete a verified rollback (and, if
   no instance was created, the definitive no-instance branch), import the
   receipt, and confirm retry becomes available only after acceptance.
8. Re-run the tamper, expiry, replay, duplicate, outage, no-secret-log, and
   deletion checks against live configuration without retaining customer
   secrets in evidence.
9. Disable the discount immediately, disable/revoke the drill license, and
   remove the live-drill build and recovery working data. Record
   operator/reviewer sign-off, UTC times, extension version, tuple, and
   sanitized outcomes in the release ticket, then return the product to Draft unless the separately approved production-launch
   sequence begins immediately, and return both variants to their
   non-purchasable state; drill success alone never authorizes leaving them
   published.

Any failed check keeps the release gate closed. A successful live purchase by
itself is not recovery-readiness sign-off.

### Post-drill handoff to production

The authoritative go/no-go and rollback procedure is **Atomic post-drill
production launch and rollback** in `PUBLISHING.md`. It is one controlled
window, not permission to enable individual pieces independently:

1. Keep main at `plans: []`, `activationRecoveryPublicJwk: null`, and paused
   customer copy. Prepare the exact `createReleaseConfig` live call and all
   customer-surface changes only on an unmerged reviewed candidate.
2. Publish the hidden product and both recurring variants, then re-query their
   exact IDs through the authenticated API. Require `published`,
   `test_mode: false`, the approved monthly/yearly prices and recurrence,
   license keys with three activations, no additional purchasable cadence, and
   two distinct checkout URLs mapped to the intended variants.
3. Before merge, use the unmerged build and a non-team live checkout to prove
   receipt delivery, activation, exact-instance validation, deactivation,
   refund/cancellation, license revocation, rejected reactivation, and zero
   orphan instances. Clean the discount, license, instances, and restricted
   data, then obtain two-operator sign-off.
4. Merge only the exact tested candidate. Its three customer surfaces must move
   together: config-driven checkout in the extension, unpaused public pricing,
   and current activation-helper instructions. Enhanced and Meeting remain
   disabled.

On any pre-merge failure, do not merge: return the product and both variants to
Draft, keep the storefront hidden, clean up every discount/order/license and
instance, delete the drill data, and leave the production config empty and all
customer surfaces paused. A post-publication failure requires immediately
making the hidden product unavailable and publishing the reviewed empty-config,
paused-copy rollback described in `PUBLISHING.md`.

## Why this is separate from `server/**` and Railway

The recovery tool has administrative Lemon Squeezy read/mutation authority and
the receipt private key. The service under `server/**` is the separately gated
cloud-transcription proxy. Giving that Internet-facing service recovery
credentials would enlarge its blast radius and couple customer license repair
to an unrelated cloud rollout.

`railway.json` watches `server/**`, so placing the operator tool there would
also make a recovery change eligible for an automatic production proxy deploy.
The operator workflow, secrets, monitoring, release evidence, and incident
response therefore remain intentionally outside `server/**` and Railway. Do
not add a recovery route to the proxy and do not copy its administrative
credential or signing key into Railway variables.

The future cloud launch still follows the separate client-first proxy rollout
in `PUBLISHING.md`. Passing this recovery drill does not enable Enhanced or
Meeting modes, change cloud entitlements, or authorize a Railway deployment.
