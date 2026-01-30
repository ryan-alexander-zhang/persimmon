/**
 * Annotation usage rules.
 *
 * <p>Rules in this package prevent technical/framework annotations from leaking into layers that
 * must stay pure (especially domain). The checks are based on annotation package name prefixes to
 * avoid compile-time dependencies on specific frameworks.
 */
package com.ryan.persimmon.arch.annotation;
