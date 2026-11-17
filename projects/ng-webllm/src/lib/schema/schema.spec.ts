import { LlmError } from '../errors';
import { parsePartialJson } from './partial-json';
import { s } from './schema';

const verdict = s.object({
  reasoning: s.string(),
  solved: s.boolean(),
  npcReply: s.string(),
});

describe('s', () => {
  it('keeps the order of the keys in the JSON schema', () => {
    const json = JSON.parse(verdict.toJsonSchema());

    expect(Object.keys(json.properties)).toEqual(['reasoning', 'solved', 'npcReply']);
    expect(json.required).toEqual(['reasoning', 'solved', 'npcReply']);
    expect(json.additionalProperties).toBe(false);
  });

  it('parses and types a valid answer', () => {
    const value: s.Infer<typeof verdict> = verdict.parse(
      '{"reasoning":"wind","solved":true,"npcReply":"Thanks!"}',
    );

    expect(value).toEqual({ reasoning: 'wind', solved: true, npcReply: 'Thanks!' });
  });

  it('rejects text that is not JSON', () => {
    expect(() => verdict.parse('Sure! The villager says')).toThrowError(LlmError);
  });

  it('says which field is wrong', () => {
    try {
      verdict.parse('{"reasoning":"x","solved":"yes","npcReply":"ok"}');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).code).toBe('invalid-output');
      expect((error as LlmError).message).toContain('solved');
    }
  });

  it('checks enums, integers and list sizes', () => {
    const villager = s.object({
      mood: s.enum(['happy', 'grumpy']),
      age: s.integer(),
      wishes: s.array(s.string(), { minItems: 1, maxItems: 2 }),
    });

    expect(villager.validate({ mood: 'happy', age: 3, wishes: ['a'] }).mood).toBe('happy');
    expect(() => villager.validate({ mood: 'sad', age: 3, wishes: ['a'] })).toThrow();
    expect(() => villager.validate({ mood: 'happy', age: 3.5, wishes: ['a'] })).toThrow();
    expect(() => villager.validate({ mood: 'happy', age: 3, wishes: [] })).toThrow();
  });
});

describe('parsePartialJson', () => {
  it('grows strings as they arrive', () => {
    expect(parsePartialJson('{"reasoning":"The wi')).toEqual({ reasoning: 'The wi' });
  });

  it('shows booleans and numbers only once complete', () => {
    expect(parsePartialJson('{"a":"x","solved":tr')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"n":12')).toEqual({});
    expect(parsePartialJson('{"n":12,')).toEqual({ n: 12 });
  });

  it('leaves out a key until its value starts', () => {
    expect(parsePartialJson('{"a":"x","npcRe')).toEqual({ a: 'x' });
    expect(parsePartialJson('{"a":"x","npcReply":')).toEqual({ a: 'x' });
  });

  it('reads nested lists and escapes', () => {
    expect(parsePartialJson('{"list":["one","tw')).toEqual({ list: ['one', 'tw'] });
    expect(parsePartialJson('{"say":"a\\"b\\')).toEqual({ say: 'a"b' });
  });

  it('returns undefined when nothing has been written', () => {
    expect(parsePartialJson('')).toBeUndefined();
    expect(parsePartialJson('  ')).toBeUndefined();
  });

  it('reads a complete document like JSON.parse', () => {
    const text = '{"reasoning":"ok","solved":false,"npcReply":"No."}';
    expect(parsePartialJson(text)).toEqual(JSON.parse(text));
  });
});
