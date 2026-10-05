import { configureGlobal } from 'fast-check';
import { fastCheckParameters } from './fast-check';

configureGlobal(fastCheckParameters(process.env));
