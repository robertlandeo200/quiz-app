// Row format: [question, correct answer, wrong1, wrong2, wrong3, explanation]
// Options are rotated at seed time so the correct index varies; the key lives only in the DB.
export const QUIZZES = [
  { slug: 'agent-fundamentals', title: 'Agent Fundamentals', category: 'Agents',
    description: 'Loops, tools, memory and guardrails for AI agents.',
    questions: [
      ['What best distinguishes an AI agent from a single LLM call?', 'It loops: observe, decide, act with tools until done', 'It uses a larger model', 'It never needs a prompt', 'It only runs offline', 'Agents iterate over observations and tool calls toward a goal; a single call is one-shot.'],
      ['The ReAct pattern alternates between…', 'Reasoning and acting', 'Training and inference', 'Caching and streaming', 'Planning and deleting', 'ReAct interleaves reasoning traces with tool actions.'],
      ['Why cap an agent at a maximum number of steps?', 'To prevent runaway loops and cost', 'APIs require it', 'To shorten prompts', 'To improve tokenization', 'A step budget bounds cost and stops infinite loops.'],
      ['Tool descriptions mainly help the model…', 'Decide when and how to call the tool', 'Compress context', 'Authenticate users', 'Cache results', 'The model chooses tools based on their name, description and schema.'],
      ['Agent "memory" is typically used to…', 'Persist context across steps or sessions', 'Store model weights', 'Speed up GPUs', 'Encrypt prompts', 'Memory carries relevant facts beyond one context window or session.'] ] },
  { slug: 'prompt-engineering', title: 'Prompt Engineering', category: 'Prompting',
    description: 'Write clearer, safer and more reliable prompts.',
    questions: [
      ['Few-shot prompting means…', 'Including a few examples in the prompt', 'Fine-tuning for few epochs', 'Using very short prompts', 'Sampling few tokens', 'Examples in the prompt steer format and behavior without training.'],
      ['A system prompt is best used to…', 'Set role, rules and tone for the conversation', 'Store user data', 'Replace tools', 'Raise temperature', 'It carries persistent instructions that frame every turn.'],
      ['What yields more reliable structured output?', 'An explicit schema plus an example', 'Asking politely', 'Removing instructions', 'Raising temperature', 'Explicit formats with examples reduce ambiguity.'],
      ['Lowering temperature generally…', 'Makes output more deterministic', 'Makes output more creative', 'Enlarges the context window', 'Removes token costs', 'Lower temperature concentrates sampling on likely tokens.'],
      ['Prompt injection is…', 'Untrusted input trying to override your instructions', 'A prompt compiler', 'A caching technique', 'A fine-tuning method', 'Treat user/tool content as data, never as trusted instructions.'] ] },
  { slug: 'workflow-automation', title: 'Workflow Automation', category: 'Workflows',
    description: 'Chaining, retries, evals and human oversight.',
    questions: [
      ['Prompt chaining is…', "Feeding one step's output into the next prompt", 'Running one prompt in parallel', 'Merging two models', 'Cropping context', 'Chains split a task into sequential, checkable steps.'],
      ['An idempotent workflow step…', 'Has the same effect when run twice as once', 'Always runs faster', 'Never fails', 'Needs no input', 'Idempotency makes retries safe.'],
      ['When add human-in-the-loop approval?', 'For high-impact or irreversible actions', 'For every trivial read', 'Never', 'Only in development', 'Humans should gate risky actions such as payments or deletions.'],
      ['Evals are used to…', 'Measure output quality on test cases and catch regressions', 'Replace logging', 'Speed up retries', 'Train the base model', 'Evals make prompt/agent changes measurable.'],
      ['Exponential backoff retries address…', 'Transient failures and rate limits', 'Prompt length', 'Hallucinations', 'Token counting', 'Spacing out retries relieves rate limits and temporary errors.'] ] }
];
export async function seed(run, sql) {
  const { recordset } = await run('SELECT COUNT(*) n FROM Quizzes');
  if (recordset[0].n > 0) return;
  for (const [qi, z] of QUIZZES.entries()) {
    const ins = await run('INSERT INTO Quizzes(slug,title,category,description) OUTPUT inserted.id VALUES(@s,@t,@c,@d)',
      { s: [sql.NVarChar, z.slug], t: [sql.NVarChar, z.title], c: [sql.NVarChar, z.category], d: [sql.NVarChar, z.description] });
    const quizId = ins.recordset[0].id;
    for (const [i, row] of z.questions.entries()) {
      const [text, ...rest] = row; const expl = rest.pop();
      const shift = (i * 3 + qi) % rest.length;
      const options = rest.map((_, k) => rest[(k - shift + rest.length) % rest.length]);
      await run('INSERT INTO Questions(quiz_id,position,text,options,correct_index,explanation) VALUES(@z,@p,@t,@o,@c,@e)',
        { z: [sql.Int, quizId], p: [sql.Int, i + 1], t: [sql.NVarChar, text], o: [sql.NVarChar, JSON.stringify(options)],
          c: [sql.Int, options.indexOf(rest[0])], e: [sql.NVarChar, expl] });
    }
  }
}
