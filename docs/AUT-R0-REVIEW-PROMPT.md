# GPT Review Request — AUT-R0

Please review the attached `AUT-R0-REVIEW-PACKAGE.zip` for:

1. provider-neutral Requirement production wiring;
2. opaque process-owned InputRef safety and absence of durable raw prompts;
3. authenticated `webgpt.requirement start|draft|reconcile` Control Plane entry;
4. PolicyVersion → ActionIntent → ActionAttempt → ProviderRequest →
   Observation/Receipt correlation and recovery behavior;
5. no direct concrete WebGPT production imports under `src/automation/**`;
6. ProviderResult identity validation, no blind resend, and no fallback target;
7. preservation of the V1 Frozen Core and old donor.

Important evidence boundary: the live AUT-R0 Requirement provider smoke was not
run in this pass. The package reports that as `NOT_RUN`, while the existing
packaged Control Plane protocol smoke and the 414-test regression gate passed.
Please distinguish contract/regression PASS from live-provider acceptance and
return any required fix list before marking AUT-R0 frozen.
