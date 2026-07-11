# ADR 0006: Registered Artifact Protocol

Future workbench artifacts have a versioned schema with a registered type,
structured data and registered user actions. The frontend renders only known
types; arbitrary component names, HTML, JavaScript and direct protected tool
calls are rejected.

```json
{"version":1,"type":"settings_confirm","data":{"label":"Theme"},"actions":["approve","reject"]}
```

Approved actions still pass permission checks and auditing. Payload size is
bounded and artifacts cannot embed secrets.
