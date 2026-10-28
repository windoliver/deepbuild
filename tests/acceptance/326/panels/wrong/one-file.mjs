// #326 AC4, wrong guard: greps one file, views.rs, where the shipped views live, so a module elsewhere passes.
import { guard } from './base.mjs';
guard({ only: 'crates/deep-app/src/views.rs' });
