# next-intl Wisdom

- Direct JSON import of a message catalog in an RSC server page is fine and is the house pattern; next-intl is still wired via the provider for client components. Importing `ar.json` directly in a server file is NOT a violation — do not re-flag it. [from: itqan]
- Dual-test the message catalog contract: assert every used key exists in the default-locale JSON AND that the stub locale mirrors the same namespace keys. [from: ITQAN]
