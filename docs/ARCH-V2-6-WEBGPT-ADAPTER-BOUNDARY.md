# ARCH-V2-6 WebGPT Adapter Boundary

`WebGptAutomationProviderPort` is the only new WebGPT provider implementation in this round. It is located under `src/features/webgpt/automation`, where it may use RoleSessionService and RequestManager types.

The Automation side receives an opaque `webgpt-role-v1:` target reference and neutral observations. Chat URLs, Role normalization, browser resource state and Request Journal records remain on the WebGPT side.

The older `WebGptExternalActionAdapter` remains a compatibility seam and is explicitly listed as incomplete migration, not a second authority.
