package com.ryan.persimmon.arch.dependency;

import static com.ryan.persimmon.arch.support.ArchTestConstants.ADAPTER_PACKAGE;
import static com.ryan.persimmon.arch.support.ArchTestConstants.APP_PACKAGE;
import static com.ryan.persimmon.arch.support.ArchTestConstants.DOMAIN_PACKAGE;
import static com.ryan.persimmon.arch.support.ArchTestConstants.INFRA_PACKAGE;
import static com.ryan.persimmon.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.ryan.persimmon.arch.support.ArchTestConstants.START_PACKAGE;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = ROOT_PACKAGE, importOptions = ImportOption.DoNotIncludeTests.class)
public class ClassDependencyChecksTest {

  /**
   * Class dependency check: domain must not even "reach" into other layers through type references.
   *
   * <p>Compared to package rules, this makes it explicit that forbidden type-level dependencies
   * (imports, member types, method calls) are not allowed.
   */
  @ArchTest
  static final ArchRule domain_must_not_access_other_layers =
      noClasses()
          .that()
          .resideInAPackage(DOMAIN_PACKAGE)
          .should()
          .accessClassesThat()
          .resideInAnyPackage(APP_PACKAGE, ADAPTER_PACKAGE, INFRA_PACKAGE, START_PACKAGE)
          .because("Domain must not reference other layers at the type level.");

  /** Class dependency check: adapter must not access domain (strict policy A). */
  @ArchTest
  static final ArchRule adapter_must_not_access_domain =
      noClasses()
          .that()
          .resideInAPackage(ADAPTER_PACKAGE)
          .should()
          .accessClassesThat()
          .resideInAPackage(DOMAIN_PACKAGE)
          .because(
              "Inbound adapters must depend on application DTOs/services, not on domain types directly.");

  /** Class dependency check: app must not access infra directly. */
  @ArchTest
  static final ArchRule app_must_not_access_infra =
      noClasses()
          .that()
          .resideInAPackage(APP_PACKAGE)
          .should()
          .accessClassesThat()
          .resideInAPackage(INFRA_PACKAGE)
          .because("Application must depend on ports, not on infrastructure implementations.");

  /** Class dependency check: only start may access infra. */
  @ArchTest
  static final ArchRule only_start_may_access_infra =
      noClasses()
          // Exclude infra itself; otherwise infra-to-infra dependencies would be forbidden,
          // making normal infrastructure internal composition impossible.
          .that()
          .resideOutsideOfPackages(START_PACKAGE, INFRA_PACKAGE)
          .should()
          .accessClassesThat()
          .resideInAPackage(INFRA_PACKAGE)
          .allowEmptyShould(true)
          .because(
              "Only the start module should wire infrastructure; other layers must stay decoupled.");
}
