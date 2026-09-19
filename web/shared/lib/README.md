# web/shared/lib

Pure, leaf-level TypeScript both games import (docs/ARCHITECTURE.md "Module boundaries and
contracts"). Compiled by `tsconfig.pure.json` without DOM or node libs; lint runs the full
functional profile here (no loops, `let`, mutation, classes, `throw` or expression statements).

| Module          | Holds                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `result.ts`     | `Result<T, E>` and `ok / err / map / mapErr / andThen / unwrapOr`                                                                                                                                                        |
| `rng.ts`        | `Rng = () => number`; `mulberry32` re-exported from `rng.algorithms.ts`                                                                                                                                                  |
| `json.ts`       | Decoder combinators over `unknown` returning `Result<T, DecodeError>`: leaves, `arrayOf`, `record`, `object` (optional fields become optional keys), `oneOf`, `map`, `refine`                                            |
| `roomCode.ts`   | Room-code alphabets, lengths, peer-id prefixes, sanitiser/validator per game                                                                                                                                             |
| `clock.ts`      | `Clock` and `Timer` types; implementations live in `web/shared/edge/clock*`                                                                                                                                              |
| `algorithms.ts` | Reserved: the shared loop escape hatch. Nothing in step 5 needs a loop, so the file does not exist yet; the first helper that does lands here with a reason comment and 100% coverage (`*.algorithms.ts` lint override). |
