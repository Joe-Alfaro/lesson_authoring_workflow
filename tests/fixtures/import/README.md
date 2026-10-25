# Import fixtures

`eld_filled.csv` is a small ELD scope-and-sequence file with content, written for R5 (the sample
ELD tab in `data/sample_unit/` has empty content columns). Its rows are matched against the sample
outline by arc and lesson type:

| Row   | Arc / type                            | Expected                                                          |
| ----- | ------------------------------------- | ----------------------------------------------------------------- |
| L1    | Spark / Spark 1                       | lesson 1: ELD standards, language objective, Launch idea, routine |
| L3    | `Spark ` (trailing space) / Spark 3   | lesson 3: content objective only (Launch cell is a space)         |
| L5    | Investigation 1 / Core Writing        | lesson 5 (1st Core Writing of the arc)                            |
| L11   | Investigation 1 / `core writing`      | lesson 11 (2nd Core Writing, case-insensitive)                    |
| L19   | Investigation 1 / Academic Discussion | lesson 19                                                         |
| L19B  | Investigation 1 / Academic Discussion | warning: the arc has only one Academic Discussion                 |
| L99   | Showcase / Spark 1                    | warning: no such type in the arc                                  |
| L98   | Investigation 3 / Core Reading        | warning: no such arc                                              |
| FLEX1 | Investigation 2 / End-of-Arc Flex Day | the first flex day after Investigation 2                          |
| L4    | Investigation 1 / Core Reading        | lesson 4, every content cell empty: nothing stored                |
