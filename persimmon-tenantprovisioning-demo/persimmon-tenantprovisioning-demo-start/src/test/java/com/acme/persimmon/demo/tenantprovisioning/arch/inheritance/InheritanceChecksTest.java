package com.acme.persimmon.demo.tenantprovisioning.arch.inheritance;

import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = ROOT_PACKAGE, importOptions = ImportOption.DoNotIncludeTests.class)
public class InheritanceChecksTest {

  /**
   * Inheritance check: domain exceptions should be unchecked (RuntimeException).
   *
   * <p>Optional/Reserved: adjust if you introduce a domain-specific base exception type.
   */
  @ArchTest
  static final ArchRule domain_exceptions_should_be_runtime_exceptions =
      classes()
          .that()
          .resideInAPackage("..domain..exception..")
          .and()
          .doNotHaveSimpleName("package-info")
          .should()
          .beAssignableTo(RuntimeException.class)
          .allowEmptyShould(true)
          .because(
              "Domain exceptions typically represent business rule violations and are commonly unchecked.");
}
