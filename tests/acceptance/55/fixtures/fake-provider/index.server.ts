// #55's stand-in agent for a real paseo daemon (README, The worlds): a provider plugin that answers every prompt with
// one short turn and, as an agent with MCP support does, starts each stdio MCP server its session is opened with and
// lists that server's tools. It stands in for the model and the agent's CLI, which this repo doesn't own. It decides
// nothing about DeepBuild.
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fakeProvider } from "./server/fake.ts";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(fakeProvider());
  return () => {};
}
