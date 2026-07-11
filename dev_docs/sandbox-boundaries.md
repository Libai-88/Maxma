# Sandbox Boundaries

`run_python` has two independent protection layers.

1. The application layer is compute-only: a fixed capability allowlist permits
   safe builtins and a minimal environment while denying filesystem, network,
   and arbitrary-process capabilities.  Path-based tool implementations should
   use `tools.path_security.require_path_access()` and operate only on the
   canonical path it returns.
2. `SandboxRunner` adds the strongest available OS mechanism.  Linux may use
   firejail; Unix can fall back to an address-space limit; Windows uses a Job
   Object for a memory limit and child-process cleanup.

The Windows Job Object branch is intentionally reported as `degraded`: it does
not provide a restricted access token, an OS firewall rule, or filesystem ACL
isolation.  The runtime report exposes those missing guarantees rather than
claiming full system isolation.  A restricted-token implementation requires a
separate identity and ACL design before it can safely be enabled.
