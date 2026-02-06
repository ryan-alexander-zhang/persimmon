package com.acme.persimmon.demo.tenantprovisioning.arch.layer;

import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.ADAPTER_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.APP_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.DOMAIN_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.INFRA_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.START_PACKAGE;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.Architectures.layeredArchitecture;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

/**
 * Mandatory strict layer checks (Policy A).
 *
 * <p>Strict policy:
 *
 * <ul>
 *   <li>{@code adapter -> app -> domain}
 *   <li>{@code infra -> domain}
 *   <li>{@code start} wires everything, and is the only layer that may reference {@code infra}
 *   <li>{@code adapter} must NOT depend on {@code domain} directly
 * </ul>
 */
@AnalyzeClasses(packages = ROOT_PACKAGE, importOptions = ImportOption.DoNotIncludeTests.class)
public class LayerChecksTest {

  @ArchTest
  static final ArchRule layered_architecture_must_follow_dependency_direction =
      layeredArchitecture()
          .consideringAllDependencies()
          .layer("Domain")
          .definedBy(DOMAIN_PACKAGE)
          .layer("App")
          .definedBy(APP_PACKAGE)
          .layer("Adapter")
          .definedBy(ADAPTER_PACKAGE)
          .layer("Infra")
          .definedBy(INFRA_PACKAGE)
          .layer("Start")
          .definedBy(START_PACKAGE)
          .whereLayer("Domain")
          .mayOnlyBeAccessedByLayers("App", "Infra", "Start")
          .whereLayer("App")
          .mayOnlyBeAccessedByLayers("Adapter", "Infra", "Start")
          .whereLayer("Adapter")
          .mayOnlyBeAccessedByLayers("Start")
          .whereLayer("Infra")
          .mayOnlyBeAccessedByLayers("Start")
          .whereLayer("Start")
          .mayNotBeAccessedByAnyLayer()
          .because(
              "Layer boundaries must remain strict to keep domain purity and enforce dependency inversion.");

  @ArchTest
  static final ArchRule domain_must_not_depend_on_app_adapter_infra_or_start =
      noClasses()
          .that()
          .resideInAPackage(DOMAIN_PACKAGE)
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(APP_PACKAGE, ADAPTER_PACKAGE, INFRA_PACKAGE, START_PACKAGE)
          .because("Domain must be pure and independent from other layers.");

  @ArchTest
  static final ArchRule app_must_not_depend_on_adapter_or_infra_or_start =
      noClasses()
          .that()
          .resideInAPackage(APP_PACKAGE)
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(ADAPTER_PACKAGE, INFRA_PACKAGE, START_PACKAGE)
          .because(
              "Application layer orchestrates use cases but must not depend on inbound adapters or infrastructure.");

  @ArchTest
  static final ArchRule adapter_must_not_depend_on_domain_or_infra_or_start =
      noClasses()
          .that()
          .resideInAPackage(ADAPTER_PACKAGE)
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(DOMAIN_PACKAGE, INFRA_PACKAGE, START_PACKAGE)
          .because(
              "Inbound adapters must call the application layer only, and must not reach into domain or infra.");

  @ArchTest
  static final ArchRule infra_must_not_depend_on_adapter_or_app_or_start =
      noClasses()
          .that()
          .resideInAPackage(INFRA_PACKAGE)
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(ADAPTER_PACKAGE, START_PACKAGE)
          .because(
              "Infrastructure implements ports and technical details; it must not depend on adapter/start.");
}
