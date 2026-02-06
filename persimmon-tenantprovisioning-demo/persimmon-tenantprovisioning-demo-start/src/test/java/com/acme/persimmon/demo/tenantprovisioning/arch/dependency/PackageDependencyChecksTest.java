package com.acme.persimmon.demo.tenantprovisioning.arch.dependency;

import static com.acme.persimmon.demo.tenantprovisioning.arch.support.ArchTestConstants.ROOT_PACKAGE;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchIgnore;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;

@AnalyzeClasses(packages = ROOT_PACKAGE, importOptions = ImportOption.DoNotIncludeTests.class)
public class PackageDependencyChecksTest {

  /**
   * Package dependency check: there must be no cyclic dependencies between top-level modules.
   *
   * <p>This slices by the first segment after {@code com.acme.persimmon.demo.tenantprovisioning}, for example: {@code
   * domain/app/adapter/infra/start}.
   */
  @ArchTest
  static final ArchRule top_level_module_slices_should_be_free_of_cycles =
      slices()
          .matching("com.acme.persimmon.demo.tenantprovisioning.(*)..")
          .should()
          .beFreeOfCycles()
          .because("Top-level modules must not form cycles; cycles erase architecture boundaries.");

  /**
   * Package dependency check (reserved): add further package-level whitelists/blacklists here when
   * submodule packaging becomes more complex.
   */
  @ArchTest @ArchIgnore
  static final ArchRule reserved_for_future_package_dependency_rules =
      slices()
          .matching("com.acme.persimmon.demo.tenantprovisioning.(*)..")
          .should()
          .notDependOnEachOther()
          .allowEmptyShould(true)
          .because(
              "Reserved: can be enabled later if you need to prevent any cross-module dependencies at all.");
}
