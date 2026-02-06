package com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.acme.persimmon.demo.tenantprovisioning.infra.repository.tenant.po.TenantPO;
import org.apache.ibatis.annotations.Mapper;

@Mapper
public interface TenantMapper extends BaseMapper<TenantPO> {}

