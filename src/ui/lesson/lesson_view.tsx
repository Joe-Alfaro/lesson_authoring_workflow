// R19: the read-only, teacher-facing lesson (mockups R19-lesson-view, R19-lesson-view-mobile).
// Labels sit inline the way a printed guide reads; ELD and support boxes are expanded.
import type { ReactNode } from 'react'
import type { Block, LessonContent, Part, Section } from '../../lesson/schema'
import {
  LESSON_TYPE_NAMES,
  lessonLabel,
  minutesLabel,
  routineName,
  SECTION_COLOURS,
  SECTION_NAMES,
  sectionAnchor,
} from '../../lesson/labels'
import { Icon } from './lesson_icons'
import { RichText } from './rich_text'
import { StandardChip } from './standard_chip'

interface ViewProps {
  content: LessonContent
  unitNumber: number
  /** Codes in the reference data; others show as warning chips (R3). */
  knownCodes: Set<string>
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D']

function Blk({
  label,
  className = '',
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`blk ${className}`}>
      <div className="g">{label}</div>
      <div className="c">{children}</div>
    </div>
  )
}

function Box({
  title,
  icon,
  children,
}: {
  title: ReactNode
  icon: Parameters<typeof Icon>[0]['name']
  children: ReactNode
}) {
  return (
    <div className="box">
      <div className="bt">
        <Icon name={icon} />
        {title}
      </div>
      {children}
    </div>
  )
}

function Items({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const list = items.map((item, index) => (
    <li key={index}>
      <RichText text={item} />
    </li>
  ))
  return ordered ? <ol className="prose">{list}</ol> : <ul className="prose">{list}</ul>
}

function codesNote(codes: string[] | undefined): string {
  return codes && codes.length > 0 ? ` (${codes.join(', ')})` : ''
}

function EldBox({ block }: { block: Extract<Block, { type: 'eld_instructions' }> }) {
  return (
    <Box title="Integrated ELD instructions" icon="chevronDown">
      <div className="eld-grid">
        <div>
          <h5>Purpose</h5>
          <div className="prose">
            <RichText text={block.purpose} />
          </div>
          {block.languageFocus && block.languageFocus.length > 0 ? (
            <div className="chips lang-focus">
              <span className="caption">Language focus</span>
              {block.languageFocus.map((word, index) => (
                <span key={index} className="chip sm">
                  <RichText text={word} />
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div>
          <h5>Say and ask</h5>
          <ul className="prose">
            {block.beforeActivity ? (
              <li>
                <RichText text={block.beforeActivity} />
              </li>
            ) : null}
            {block.moves.map((move, index) => (
              <li key={`m${index}`}>
                <RichText text={move} />
              </li>
            ))}
            {(block.recasts ?? []).map((recast, index) => (
              <li key={`r${index}`}>
                Recast: You said “<RichText text={recast.studentSaid} />” We can say “
                <RichText text={recast.academic} />”
              </li>
            ))}
            {block.frames.map((frame, index) => (
              <li key={`f${index}`}>
                Frame: <RichText text={frame} />
              </li>
            ))}
            {(block.assetMoves ?? []).map((move, index) => (
              <li key={`a${index}`}>
                <RichText text={move} />
              </li>
            ))}
          </ul>
          {block.leveledFrames ? (
            <ul className="prose">
              <li>
                Emerging: <RichText text={block.leveledFrames.emerging} />
              </li>
              <li>
                Expanding: <RichText text={block.leveledFrames.expanding} />
              </li>
              <li>
                Bridging: <RichText text={block.leveledFrames.bridging} />
              </li>
            </ul>
          ) : null}
        </div>
        <div>
          <h5>Watch for and support if needed</h5>
          <ul className="prose">
            {block.watchFor.map((watch, index) => (
              <li key={`w${index}`}>
                If <RichText text={watch.trigger} /> → Prompt: <RichText text={watch.prompt} />
              </li>
            ))}
            {block.successCriteria.map((criterion, index) => (
              <li key={`s${index}`}>
                Success: <RichText text={criterion} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Box>
  )
}

function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'routine':
      return (
        <h4 className="routine">
          {block.label ? <RichText text={block.label} /> : routineName(block.routine)}
        </h4>
      )
    case 'teach':
      return <h4 className="routine">{block.title ? <RichText text={block.title} /> : 'Teach'}</h4>
    case 'paragraph':
      return (
        <Blk label="Teacher" className="teacher">
          <RichText text={block.text} />
        </Blk>
      )
    case 'say':
      return (
        <Blk label="Say:" className="say">
          <RichText text={block.text} />
        </Blk>
      )
    case 'directions':
      return (
        <Blk label="Say these directions:" className="dir">
          <RichText text={block.text} />
        </Blk>
      )
    case 'ask':
      return (
        <>
          <Blk label="Ask:" className="ask">
            <RichText text={block.question} />
          </Blk>
          <Blk label="Exemplar response" className="ex">
            <RichText text={block.exemplar} />
          </Blk>
        </>
      )
    case 'connection':
      return (
        <Blk label="Connection:">
          <RichText text={block.text} />
        </Blk>
      )
    case 'sentence_starter':
      return (
        <Blk label="Sentence starter:">
          <RichText text={block.text} />
        </Blk>
      )
    case 'display':
      return (
        <Blk label={block.label ? `Display (${block.label}):` : 'Display:'}>
          <div className="disp">
            <RichText text={block.text} />
          </div>
        </Blk>
      )
    case 'list':
      return (
        <div className="blk-list">
          {block.intro ? (
            <p className="prose">
              <RichText text={block.intro} />
            </p>
          ) : null}
          <Items items={block.items} ordered={block.ordered} />
        </div>
      )
    case 'table':
      return (
        <table className="supp lesson-table">
          <caption>
            <RichText text={block.caption} />
          </caption>
          <thead>
            <tr>
              {block.headers.map((header, index) => (
                <th key={index} scope="col">
                  <RichText text={header} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index}>
                    <RichText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'teacher_tip':
      return (
        <Box title="Teacher tip" icon="info">
          <div className="prose">
            <RichText text={block.text} />
          </div>
        </Box>
      )
    case 'pulse_check':
      return (
        <Box title={`Pulse check${codesNote(block.standards)}`} icon="check">
          <div className="prose">
            <RichText text={block.stem} />
          </div>
          <ul className="opts">
            {block.options.map((option, index) => {
              const letter = OPTION_LETTERS[index] ?? String(index + 1)
              return (
                <li key={index} className={option.correct ? 'correct' : ''}>
                  <span
                    className="L"
                    role="img"
                    aria-label={`Option ${letter}${option.correct ? ', correct' : ''}`}
                  >
                    {letter}
                  </span>
                  <div>
                    <div className="prose opt-text">
                      <RichText text={option.text} />
                    </div>
                    <div className="why">
                      <b>{option.correct ? 'Correct:' : 'Incorrect:'}</b>{' '}
                      <RichText text={option.rationale} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Box>
      )
    case 'check_for_understanding':
      return (
        <Box title={`Check for understanding${codesNote(block.standards)}`} icon="target">
          <div className="prose">
            <RichText text={block.prompt} />
          </div>
          {block.lookFors && block.lookFors.length > 0 ? (
            <>
              <h5 className="box-sub">Look for</h5>
              <Items items={block.lookFors} />
            </>
          ) : null}
        </Box>
      )
    case 'reflection':
      return (
        <Box title={`Reflection${codesNote(block.standards)}`} icon="target">
          <div className="prose">
            <RichText text={block.prompt} />
          </div>
          <Items items={block.questions} />
        </Box>
      )
    case 'eld_instructions':
      return <EldBox block={block} />
    case 'student_support':
      return (
        <Box
          title={block.title ? <RichText text={block.title} /> : 'Additional student support'}
          icon="chevronDown"
        >
          <table className="supp">
            <thead>
              <tr>
                <th scope="col">Situation</th>
                <th scope="col">Try this</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, index) => (
                <tr key={index}>
                  <td>
                    {row.kind === 'extension' ? 'Ready for extension' : 'Struggling with'}
                    {row.focus ? (
                      <>
                        : <RichText text={row.focus} />
                      </>
                    ) : null}
                  </td>
                  <td>
                    <RichText text={row.tryThis} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )
    case 'rubric':
      return (
        <Box title={<RichText text={block.title} />} icon="target">
          <div className="prose">
            <RichText text={block.prompt} />
          </div>
          <table className="supp rubric">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                {block.levels.map((level, index) => (
                  <th key={index} scope="col">
                    <RichText text={level} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.criteria.map((criterion, index) => (
                <tr key={index}>
                  <td>
                    <RichText text={criterion.name} />
                    {criterion.standard ? (
                      <span className="chip sm">{criterion.standard}</span>
                    ) : null}
                  </td>
                  {criterion.descriptors.map((descriptor, cell) => (
                    <td key={cell}>
                      <RichText text={descriptor} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )
  }
}

function PartHeading({ part, inAction }: { part: Part; inAction: boolean }) {
  if (!part.label && !part.title) return null
  if (!inAction) {
    return <h4 className="routine">{[part.label, part.title].filter(Boolean).join(': ')}</h4>
  }
  const name = [part.label ? `Part ${part.label}` : null, part.title].filter(Boolean).join(': ')
  return (
    <h3 className="part-h">
      <RichText text={name} />
      {part.standards.map((code) => (
        <span key={code} className="chip sm">
          {code}
        </span>
      ))}
      {part.minutes ? <span className="caption part-min">{minutesLabel(part.minutes)}</span> : null}
    </h3>
  )
}

function SectionView({ section, index }: { section: Section; index: number }) {
  const inAction = section.kind === 'learning_in_action'
  return (
    <section className={`sec ${SECTION_COLOURS[section.kind]}`} id={sectionAnchor(section.kind)}>
      <div className="sec-h">
        <h2>
          <span className="no">{index + 1}</span> {SECTION_NAMES[section.kind]}
        </h2>
        <span className="mins">{minutesLabel(section.minutes)}</span>
      </div>
      {section.parts.map((part, partIndex) => (
        <div key={part.id ?? partIndex} className="part">
          <PartHeading part={part} inAction={inAction} />
          {part.blocks.map((block, blockIndex) => (
            <BlockView key={block.id ?? blockIndex} block={block} />
          ))}
        </div>
      ))}
    </section>
  )
}

function routinesOf(section: Section): string {
  return section.parts
    .flatMap((part) => part.blocks)
    .filter((block) => block.type === 'routine')
    .map((block) => (block.type === 'routine' ? (block.label ?? routineName(block.routine)) : ''))
    .join(', ')
}

/** The pacing table built from the section minutes (R19; D-016: pacing isn't stored twice). */
export function PacingTable({ sections, duration }: { sections: Section[]; duration: number }) {
  const total = sections.reduce((sum, section) => sum + section.minutes, 0)
  return (
    <>
      <div
        className="ribbon pace-ribbon"
        role="img"
        aria-label={`Pacing: ${sections.map((s) => `${SECTION_NAMES[s.kind]} ${s.minutes}`).join(', ')} minutes`}
      >
        {sections.map((section, index) => (
          <i
            key={index}
            className={SECTION_COLOURS[section.kind]}
            style={{ flex: section.minutes }}
          />
        ))}
      </div>
      <table className="pace">
        <thead>
          <tr>
            <th scope="col">Lesson flow</th>
            <th scope="col">Purpose of learning experience</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section, index) => {
            const routines = routinesOf(section)
            const parts = section.parts.filter((part) => part.label || part.title)
            return (
              <tr key={section.id ?? index}>
                <td>
                  <span className={`sw ${SECTION_COLOURS[section.kind]}`} />
                  {SECTION_NAMES[section.kind]}, {minutesLabel(section.minutes)}
                </td>
                <td>
                  <RichText text={section.purpose} />
                  {section.kind === 'learning_in_action'
                    ? parts.map((part, partIndex) => (
                        <div key={part.id ?? partIndex}>
                          <b>
                            {part.label ? `Part ${part.label}: ` : ''}
                            <RichText text={part.title ?? ''} />
                          </b>
                          {codesNote(part.standards)}
                          {part.minutes ? `, ${minutesLabel(part.minutes)}.` : ''}{' '}
                          {part.purpose ? <RichText text={part.purpose} /> : null}
                        </div>
                      ))
                    : null}
                  {routines ? <div className="caption">{routines}</div> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="pace derived">
        Total {total} of {duration} minutes.
      </p>
    </>
  )
}

export function LessonView({ content, unitNumber, knownCodes }: ViewProps) {
  const { frontMatter, body } = content
  const label = lessonLabel(frontMatter.number)
  const chips = (codes: string[]) => (
    <div className="chips">
      {codes.map((code) => (
        <StandardChip key={code} code={code} known={knownCodes.has(code)} />
      ))}
    </div>
  )
  return (
    <article className="doc" aria-label={label}>
      <div className="kicker">
        Unit {unitNumber}: {frontMatter.unitTitle}
      </div>
      <h1 className="lt">
        {label}: <RichText text={body.title} />
      </h1>
      <div className="meta">
        <span>{frontMatter.arc}</span>
        <span>{LESSON_TYPE_NAMES[frontMatter.type]}</span>
        <span>{minutesLabel(frontMatter.durationMinutes)}</span>
      </div>
      <dl className="fm">
        <dt>Focus standards</dt>
        <dd>{chips(frontMatter.focusStandards)}</dd>
        <dt>Supporting standards</dt>
        <dd>{chips(frontMatter.supportingStandards)}</dd>
        <dt>ELD standards</dt>
        <dd>{chips(frontMatter.eldStandards.map((eld) => eld.code))}</dd>
        <dt>Lesson texts</dt>
        <dd>
          {frontMatter.texts.map((text, index) => (
            <div key={index}>
              <b>
                <i>{text.title}</i>
              </b>
              {text.source ? `, ${text.source}` : ''}
              {text.pages ? `. ${text.pages}` : ''}
            </div>
          ))}
        </dd>
        <dt>Vocabulary</dt>
        <dd>
          <span>{body.vocabulary.addressed.map((entry) => entry.term).join(', ')}</span>
          {body.vocabulary.support.length > 0 ? (
            <div className="caption">
              For additional support:{' '}
              {body.vocabulary.support.map((entry) => entry.term).join(', ')}
            </div>
          ) : null}
        </dd>
        <dt>Materials</dt>
        <dd>{body.materials.join('; ')}</dd>
      </dl>

      <h2 className="dh">Student learning objectives</h2>
      <ol className="prose obj">
        <li>
          <b>Content.</b> <RichText text={body.objectives.content} />
        </li>
        <li>
          <b>Language.</b> <RichText text={body.objectives.language} />
        </li>
        {body.objectives.foundationalSkills ? (
          <li>
            <b>Foundational skills.</b> <RichText text={body.objectives.foundationalSkills} />
          </li>
        ) : null}
      </ol>
      <h2 className="dh">Essential questions</h2>
      <Items items={body.essentialQuestions} />
      <h2 className="dh">Connections</h2>
      <dl className="fm conn">
        <dt>Knowledge-building</dt>
        <dd className="prose">
          <RichText text={body.connections.knowledgeBuilding} />
        </dd>
        <dt>Enduring understanding</dt>
        <dd className="prose">
          <RichText text={body.connections.enduringUnderstanding} />
        </dd>
        <dt>Future lessons</dt>
        <dd className="prose">
          <RichText text={body.connections.futureLessons} />
        </dd>
        <dt>Unit performance task</dt>
        <dd className="prose">
          <RichText text={body.connections.unitPerformanceTask} />
        </dd>
      </dl>

      <h2 className="dh">Lesson pacing</h2>
      <PacingTable sections={body.sections} duration={frontMatter.durationMinutes} />

      {body.sections.map((section, index) => (
        <SectionView key={section.id ?? index} section={section} index={index} />
      ))}
      {body.homework ? (
        <section className="sec homework" id={sectionAnchor('homework')}>
          <div className="sec-h">
            <h2>Homework</h2>
          </div>
          {body.homework.intro ? (
            <p className="prose">
              <RichText text={body.homework.intro} />
            </p>
          ) : null}
          <Items items={body.homework.tasks} />
          {body.homework.teacherTip ? (
            <Box title="Teacher tip" icon="info">
              <div className="prose">
                <RichText text={body.homework.teacherTip} />
              </div>
            </Box>
          ) : null}
        </section>
      ) : null}
    </article>
  )
}

/** At 390 wide: a sticky chip row that jumps between sections (R19 mobile). */
export function SectionJump({ content }: { content: LessonContent }) {
  return (
    <nav className="jump" aria-label="Sections">
      {content.body.sections.map((section, index) => (
        <a key={section.id ?? index} href={`#${sectionAnchor(section.kind)}`}>
          <span className={`sw ${SECTION_COLOURS[section.kind]}`} />
          {SECTION_NAMES[section.kind]}
        </a>
      ))}
      {content.body.homework ? <a href={`#${sectionAnchor('homework')}`}>Homework</a> : null}
    </nav>
  )
}
