package com.ryan.persimmon.arch.annotation;

import static com.ryan.persimmon.arch.support.ArchTestConstants.DOMAIN_PACKAGE;
import static com.ryan.persimmon.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.ryan.persimmon.arch.support.AnnotationPredicates;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = ROOT_PACKAGE, importOptions = ImportOption.DoNotIncludeTests.class)
public class AnnotationChecksTest {

  /**
   * Annotation check: domain must not use framework/technical annotations.
   *
   * <p>This check is intentionally implemented using annotation package prefixes to avoid
   * introducing compile-time dependencies on specific frameworks.
   */
  @ArchTest
  static final ArchRule domain_should_not_use_spring_annotations =
      classes()
          .that()
          .resideInAPackage(DOMAIN_PACKAGE)
          .should(AnnotationPredicates.notBeAnnotatedWithAnyInPackage("org.springframework"))
          .allowEmptyShould(true)
          .because(
              "Domain must stay framework-free; Spring stereotypes belong to adapters/infra/start only.");

  /**
   * Annotation check: domain must not use persistence annotations.
   *
   * <p>Optional/Reserved: enable/tune as you pick a persistence technology.
   */
  @ArchTest
  static final ArchRule domain_should_not_use_persistence_annotations =
      classes()
          .that()
          .resideInAPackage(DOMAIN_PACKAGE)
          .should(AnnotationPredicates.notBeAnnotatedWithAnyInPackage("jakarta.persistence"))
          .allowEmptyShould(true)
          .because("Persistence annotations should not leak into domain types.");
}
