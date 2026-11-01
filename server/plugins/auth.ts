import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/", "/landing"],
  // The public product landing lives at `/`; keep auth on API/actions and let
  // the Agent-Native app shell manage sign-in on private capabilities.
  rootAuth: false,
  marketing: false,
});
