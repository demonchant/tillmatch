// One-process runner is usable in restricted Windows sandboxes where `node --test`
// cannot spawn its default child process for each test file.
import "./csv.test.mjs";
import "./matcher.test.mjs";
import "./paystack.test.mjs";
