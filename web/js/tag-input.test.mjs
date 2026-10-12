import assert from 'node:assert/strict';
import { completeTag, splitInput } from './tag-input.js';

assert.equal(completeTag('  rock '), 'rock');
assert.equal(completeTag('mood:calm'), 'mood:calm');
assert.equal(completeTag('mood:'), '');
assert.equal(completeTag(':x'), '');
assert.equal(completeTag(' : '), '');
assert.equal(completeTag('   '), '');
assert.deepEqual(splitInput('a, mood:, b:c, :x'), { tags: ['a', 'b:c'], rest: 'mood:, :x' });
assert.deepEqual(splitInput(''), { tags: [], rest: '' });
console.log('tag-input tests passed');
