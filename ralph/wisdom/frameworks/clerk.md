# Clerk Auth Wisdom

- Mock `@clerk/backend` BEFORE importing auth-dependent modules. Import order matters. [from: BoxBox]
- Ownership chain: clerkId -> account -> customer -> resource (multi-level FK traversal). [from: BoxBox]
