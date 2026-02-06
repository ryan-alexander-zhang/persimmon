package com.acme.persimmon.demo.tenantprovisioning.arch.annotation;

import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.DOMAIN_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.APP_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.acme.persimmon.demo.tenantprovisioning.arch.support.AnnotationPredicates;
import com.tngtech.archunit.core.domain.JavaAnnotation;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;

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

  /**
   * Annotation check: application layer may use Spring TX annotations for transaction boundaries,
   * but should avoid other Spring stereotypes to keep the app layer mostly framework-agnostic.
   */
  @ArchTest
  static final ArchRule app_should_not_use_spring_annotations_except_spring_tx =
      classes()
          .that()
          .resideInAPackage(APP_PACKAGE)
          .should(notBeAnnotatedWithSpringExceptTransaction())
          .allowEmptyShould(true)
          .because(
              "App may use Spring transaction annotations (scheme A), but should not depend on other Spring stereotypes.");

  private static ArchCondition<JavaClass> notBeAnnotatedWithSpringExceptTransaction() {
    return new ArchCondition<>("not be annotated with Spring annotations except spring-tx") {
      @Override
      public void check(JavaClass item, ConditionEvents events) {
        for (JavaAnnotation<?> annotation : item.getAnnotations()) {
          String annotationTypeName = annotation.getRawType().getName();
          if (!annotationTypeName.startsWith("org.springframework.")) {
            continue;
          }
          if (annotationTypeName.startsWith("org.springframework.transaction.annotation.")) {
            continue;
          }
          String message = item.getName() + " is annotated with @" + annotationTypeName;
          events.add(SimpleConditionEvent.violated(item, message));
          return;
        }
        events.add(SimpleConditionEvent.satisfied(item, item.getName() + " has no forbidden annotations"));
      }
    };
  }
}
